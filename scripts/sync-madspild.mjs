// Stop madspild items at every Netto, føtex and Bilka in Denmark → out/clearances.json.
// Salling allows 100 Anti Food Waste requests a day, and each request returns the stores nearest a point
// (about 15). points.json holds 76 points planned from the stores' locations so that together they reach all
// of them, which leaves room for a manual re-run on a bad day. The token comes from the SALLING_TOKEN secret.

import fs from 'node:fs';

const OUT = 'out/clearances.json';
const POINTS = JSON.parse(fs.readFileSync(new URL('./points.json', import.meta.url), 'utf8'));
const RADIUS_KM = 40; // generous, so rural points still reach their nearest stores
const MAX_REQUESTS = 85; // stays under Salling's 100 a day

const token = process.env.SALLING_TOKEN?.trim();
if (!token) {
  console.error('SALLING_TOKEN is not set.');
  process.exit(1);
}

/** Salling's top-level category (English) → Sparø list category. */
function categoryOf(path) {
  const [top = '', second = ''] = (path ?? '').toLowerCase().split('>');
  if (top.includes('bread') || top.includes('cake')) return 'bakery';
  if (top.includes('dairy') || top.includes('cold')) return 'dairy';
  if (top.includes('meat') || top.includes('fish')) return second.includes('fish') ? 'fish' : 'meat';
  if (top.includes('fruit') || top.includes('vegetable')) return 'produce';
  if (top.includes('frozen')) return 'frozen';
  if (top.includes('drink') || top.includes('beverage')) return 'drinks';
  if (top.includes('snack') || top.includes('candy') || top.includes('sweet')) return 'snacks';
  if (top.includes('household') || top.includes('cleaning')) return 'household';
  if (top.includes('colonial') || top.includes('grocer') || top.includes('pantry')) return 'pantry';
  return 'other';
}

/** "DET GODE GULEROD SCHULSTAD" → "Det Gode Gulerod Schulstad". */
function niceName(s) {
  return (s ?? '').toLowerCase().replace(/(^|[\s\-/(])([a-zæøå])/g, (_, a, b) => a + b.toUpperCase()).trim();
}

const wait = (s) => new Promise((ok) => setTimeout(ok, s * 1000));
const storesById = new Map();
const items = new Map();
let requests = 0;
let pause = 2; // seconds between requests; Salling's Retry-After header can raise it

for (const [lat, lng] of POINTS) {
  if (requests >= MAX_REQUESTS) { console.warn(`Stopped at ${MAX_REQUESTS} requests.`); break; }
  if (requests > 0) await wait(pause);
  requests++;
  const res = await fetch(`https://api.sallinggroup.com/v1/food-waste/?geo=${lat},${lng}&radius=${RADIUS_KM}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, signal: AbortSignal.timeout(30000),
  });
  pause = Math.max(2, Number(res.headers.get('retry-after')) + 1 || 2);
  if (res.status === 429) { console.error(`Salling quota or spike limit reached after ${requests} requests; publishing what was collected.`); break; }
  if (!res.ok) { console.error(`${lat},${lng}: HTTP ${res.status} ${(await res.text()).slice(0, 120)}`); continue; }
  for (const { store, clearances } of await res.json()) {
    if (!storesById.has(store.id)) {
      const today = (store.hours ?? []).find((h) => h.type === 'store' && !h.closed);
      storesById.set(store.id, {
        id: store.id, chain: store.brand, name: store.name,
        lat: store.coordinates?.[1], lng: store.coordinates?.[0],
        street: store.address?.street, zip: store.address?.zip, city: store.address?.city,
        closesAt: today?.close ?? null,
      });
    }
    for (const c of clearances ?? []) {
      const image = c.product.image && !/\/image$/.test(c.product.image) ? c.product.image : null;
      const id = `${store.id}-${c.offer.ean}`;
      items.set(id, {
        id, storeId: store.id, ean: c.offer.ean ?? c.product.ean,
        title: niceName(c.product.description), category: categoryOf(c.product.categories?.en),
        newPrice: c.offer.newPrice, originalPrice: c.offer.originalPrice, percentDiscount: c.offer.percentDiscount,
        stock: c.offer.stock, stockUnit: c.offer.stockUnit, endsAt: c.offer.endTime, image,
      });
    }
  }
}

if (storesById.size < 100) throw new Error(`Only ${storesById.size} stores reached; not publishing.`);

fs.mkdirSync('out', { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({ source: 'Salling Group Anti Food Waste API', fetchedAt: new Date().toISOString(), stores: [...storesById.values()], items: [...items.values()] }));
console.log(`Saved ${storesById.size} stores and ${items.size} items to ${OUT} using ${requests} requests.`);
