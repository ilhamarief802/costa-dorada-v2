// Seeded pseudo-randomness. Every placement decision in the city comes from here, so the
// same ?seed= value always rebuilds the same Costa Dorada.

function hashString(text) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function makeRng(seed) {
  const base = typeof seed === 'number' ? seed >>> 0 : hashString(String(seed ?? '1'));
  let state = (base || 0x9e3779b9) >>> 0;

  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const rng = {
    seed: base,
    next,
    range: (min, max) => min + next() * (max - min),
    int: (min, max) => Math.floor(min + next() * (max - min + 1)),
    chance: (p) => next() < p,
    pick: (list) => list[Math.floor(next() * list.length)],
    /** Weighted pick: [[value, weight], ...]. */
    weighted(entries) {
      let total = 0;
      for (const entry of entries) total += entry[1];
      let ticket = next() * total;
      for (const entry of entries) {
        ticket -= entry[1];
        if (ticket <= 0) return entry[0];
      }
      return entries[entries.length - 1][0];
    },
    sign: () => (next() < 0.5 ? -1 : 1),
    shuffle(list) {
      const copy = list.slice();
      for (let i = copy.length - 1; i > 0; i -= 1) {
        const j = Math.floor(next() * (i + 1));
        const tmp = copy[i];
        copy[i] = copy[j];
        copy[j] = tmp;
      }
      return copy;
    },
    fork: (label) => makeRng((base ^ hashString(label)) >>> 0),
  };
  return rng;
}

export function readSeed(search = '') {
  const params = new URLSearchParams(search);
  const raw = params.get('seed');
  if (raw === null || raw === '') return 1;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.floor(Math.abs(parsed)) % 100000000 : hashString(raw);
}
