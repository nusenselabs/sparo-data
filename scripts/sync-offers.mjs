// This week's avis offers from ShelfAtlas → out/offers.json.
// The free plan allows 1,000 requests a month and a full fetch takes about 30, so the job fetches everything once a
// week (Sundays, or whenever there's no saved copy) and on other days only the offers added since the last run,
// merged into the saved copy (state/offers.json, kept between runs by the workflow's cache). That's about 250 a month.
// The key comes from the SHELFATLAS_KEY secret; it never appears in the output or the app.

import fs from 'node:fs';

const BASE = 'https://api.shelfatlas.com/api/v1/public/catalog';
const OUT = 'out/offers.json';
const STATE = 'state/offers.json';
const MAX_REQUESTS = 60; // a safety stop, well above a normal run
// Only what the app shows. ShelfAtlas asks that the file stays an app-internal resource, not a dataset.
const FIELDS = ['id', 'chain', 'chainId', 'rawName', 'price', 'originalPrice', 'unitPrice', 'unitPriceUnit', 'validFrom', 'validTo', 'volumeMl', 'unitCount'];
const slim = (o) => Object.fromEntries(FIELDS.filter((f) => o[f] != null).map((f) => [f, o[f]]));
const FULL_EVERY_DAYS = 7;

// Our chain ids → text that finds the matching ShelfAtlas chain.
const WANTED = {
  netto: 'netto', foetex: 'føtex', bilka: 'bilka', kvickly: 'kvickly', superbrugsen: 'superbrugsen',
  coop365: '365', rema1000: 'rema', lidl: 'lidl', loevbjerg: 'løvbjerg', letkoeb: 'let',
};

const key = process.env.SHELFATLAS_KEY?.trim();
if (!key) {
  console.error('SHELFATLAS_KEY is not set.');
  process.exit(1);
}

let requests = 0;
let quota = 'n/a';
async function get(path) {
  if (++requests > MAX_REQUESTS) throw new Error(`Stopped after ${MAX_REQUESTS} requests to protect the monthly allowance.`);
  const res = await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' }, signal: AbortSignal.timeout(30000) });
  quota = res.headers.get('x-quota-remaining') ?? quota;
  if (res.status === 401 || res.status === 403) throw new Error(`ShelfAtlas rejected the key (HTTP ${res.status}).`);
  if (res.status === 429) throw new Error('ShelfAtlas rate limit reached (HTTP 429).');
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${path}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

/** Every page of an offers query. */
async function allPages(query, keep) {
  let cursor = null;
  do {
    const page = await get(`/offers?${query}&limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
    for (const o of page.data ?? []) keep(o);
    cursor = page.pagination?.cursor ?? null;
  } while (cursor);
}

const chainsRes = await get('/chains');
const theirChains = chainsRes.data ?? chainsRes;
const map = {};
for (const [ours, needle] of Object.entries(WANTED)) {
  const hit = theirChains.find((c) => (c.slug ?? '').toLowerCase().includes(needle) || (c.name ?? '').toLowerCase().includes(needle));
  if (hit) map[ours] = hit;
  else console.warn(`No ShelfAtlas chain found for ${ours}`);
}
const oursById = new Map(Object.entries(map).map(([ours, c]) => [c.id, ours]));

const now = Date.now();
const current = (o) => !o.validTo || new Date(o.validTo).getTime() >= now;
const saved = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : null;
// Updates match offers to chains by id; without ids for every chain, fetch everything rather than miss offers.
const canUpdate = Object.values(map).every((c) => c.id);
const fullDue = !saved || !canUpdate || new Date().getUTCDay() === 0 || now - new Date(saved.lastFullAt).getTime() > FULL_EVERY_DAYS * 86400000;

const byId = new Map();
let lastFullAt = saved?.lastFullAt;
if (fullDue) {
  for (const [ours, chain] of Object.entries(map)) {
    let n = 0;
    await allPages(`chain_slug=${encodeURIComponent(chain.slug)}`, (o) => { if (current(o)) { byId.set(o.id, slim({ chain: ours, ...o })); n++; } });
    console.log(`${chain.name}: ${n} current offers`);
  }
  lastFullAt = new Date(now).toISOString();
} else {
  for (const o of saved.offers) if (current(o)) byId.set(o.id, slim(o));
  // An hour's overlap, so nothing ingested during the last run is missed.
  const since = new Date(new Date(saved.fetchedAt).getTime() - 3600000).toISOString();
  let added = 0;
  await allPages(`ingested_since=${encodeURIComponent(since)}`, (o) => {
    const ours = oursById.get(o.chainId);
    if (ours && current(o)) { byId.set(o.id, slim({ chain: ours, ...o })); added++; }
  });
  console.log(`Update since ${since}: ${added} new or changed offers (last full fetch ${saved.lastFullAt}).`);
}

const offers = [...byId.values()];
// A run that finds almost nothing is more likely an API problem than an empty week; don't publish it.
if (offers.length < 500) throw new Error(`Only ${offers.length} offers found; not publishing.`);

const result = { note: 'Internal data file for the Sparø app. Not an open dataset.', source: 'Offers via ShelfAtlas', fetchedAt: new Date(now).toISOString(), offers };
fs.mkdirSync('out', { recursive: true });
fs.mkdirSync('state', { recursive: true });
fs.writeFileSync('out/robots.txt', 'User-agent: *\nDisallow: /\n');
fs.writeFileSync(OUT, JSON.stringify(result));
fs.writeFileSync(STATE, JSON.stringify({ ...result, lastFullAt }));
console.log(`Saved ${offers.length} offers to ${OUT} (${fullDue ? 'full fetch' : 'update'}). Requests used: ${requests}, quota remaining: ${quota}.`);
