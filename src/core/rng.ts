// Seeded deterministic RNG (xorshift32) and FNV-1a hash for tie-breaking.
// Pure: no module-level state, no Math.random, no Date.now.
//
// Usage:
//   const rng = createRng(seed);
//   rng.next();           // u32
//   rng.nextFloat();      // [0, 1)
//   const snap = rng.clone(); // independent copy at this moment
//
// All resolver-side randomness MUST flow through this. The PoC has no
// per-roll RNG (combat is deterministic — see §3.1) but reserves the
// channel for future stochastic-mode support.

export type Rng = {
  state: number;
  next: () => number;
  nextFloat: () => number;
  clone: () => Rng;
};

export function createRng(seed: number): Rng {
  if (!Number.isInteger(seed) || (seed | 0) === 0) {
    throw new Error('createRng: seed must be a non-zero 32-bit integer');
  }
  // Force unsigned 32-bit.
  const initial = seed >>> 0;

  const rng = {
    state: initial,
    next(): number {
      let s = rng.state | 0;
      s ^= s << 13;
      s ^= s >>> 17;
      s ^= s << 5;
      rng.state = s >>> 0;
      return rng.state;
    },
    nextFloat(): number {
      // Divide by 2^32 to land in [0, 1).
      return rng.next() / 0x100000000;
    },
    clone(): Rng {
      const c = createRng(rng.state === 0 ? 1 : rng.state);
      c.state = rng.state;
      return c;
    },
  };

  return rng;
}

// FNV-1a 32-bit. Pure function. Used for initiative tie-breaking.
// Reference: http://www.isthe.com/chongo/tech/comp/fnv/
export function fnv1a32(s: string): number {
  let h = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i) & 0xff;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

// Stable per-round tie-breaker for initiative-equal units.
// Lower hash wins (sort ascending).
export function initTieKey(unitId: string, round: number): number {
  return fnv1a32(`${unitId}|${round}`);
}
