// This week's avis offers from ShelfAtlas → out/offers.json.
// Runs once a day on GitHub Actions. One run uses about 26 requests, so a month stays well inside the free plan's 1,000.
// The key comes from the SHELFATLAS_KEY secret; it never appears in the output or the app.

import fs from 'node:fs';

const BASE = 'https://api.shelfatlas.com/api/v1/public/catalog';
const OUT = 'out/offers.json';
const MAX_REQUESTS = 60; // a safety stop, well above a normal run

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

const chainsRes = await get('/chains');
const theirChains = chainsRes.data ?? chainsRes;
const map = {};
for (const [ours, needle] of Object.entries(WANTED)) {
  const hit = theirChains.find((c) => (c.slug ?? '').toLowerCase().includes(needle) || (c.name ?? '').toLowerCase().includes(needle));
  if (hit) map[ours] = hit;
  else console.warn(`No ShelfAtlas chain found for ${ours}`);
}

const now = Date.now();
const offers = [];
for (const [ours, chain] of Object.entries(map)) {
  let cursor = null;
  let n = 0;
  do {
    const page = await get(`/offers?chain_slug=${encodeURIComponent(chain.slug)}&limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
    for (const o of page.data ?? []) {
      if (o.validTo && new Date(o.validTo).getTime() < now) continue; // already ended
      offers.push({ chain: ours, ...o });
      n++;
    }
    cursor = page.pagination?.cursor ?? null;
  } while (cursor);
  console.log(`${chain.name}: ${n} current offers`);
}

// A run that finds almost nothing is more likely an API problem than an empty week; keep yesterday's file then.
if (offers.length < 500) throw new Error(`Only ${offers.length} offers found; not publishing.`);

fs.mkdirSync('out', { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({ source: 'ShelfAtlas public catalog API', fetchedAt: new Date().toISOString(), offers }));
console.log(`Saved ${offers.length} offers to ${OUT}. Requests used: ${requests}, quota remaining: ${quota}.`);
