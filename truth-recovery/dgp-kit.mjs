// ============================================================
// dgp.mjs — Known-truth data-generating process for meta-analyses,
// with a parameterised PUBLICATION-SELECTION mechanism on top of a
// known (mu, tau^2). Seeded -> fully reproducible (no Math.random).
//
// Ported in spirit from the allmeta truth-recovery yardstick
// (F:\allmeta, branch truth-recovery-unified-estimator,
//  truth-recovery-bench/dgp.py). Standalone — no external deps.
//
// A "meta-analysis" is the set of PUBLISHED studies a reviewer sees.
// Studies are drawn from the true random-effects model; a selection
// rule decides which get published; we oversample until k published
// studies are collected. So k is the observed (published) count while
// the true mu is the unconditional mean any honest method must recover.
// ============================================================

export const SCENARIOS = ['none', 'step_weak', 'step_strong', 'copas_weak', 'copas_strong'];

const STEP_CUTS = [0.025, 0.05];
const STEP_WEIGHTS = {
  weak:   [1.0, 0.75, 0.55],
  strong: [1.0, 0.35, 0.10],
};
const COPAS = {
  weak:   { g0: -0.10, g1: 0.12, rho: 0.50 },
  strong: { g0: -0.20, g1: 0.12, rho: 0.90 },
};

// --- seeded PRNG: mulberry32 ---
export function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Standard normal via Box-Muller (fresh draw each call; no cached spare so the
// stream stays deterministic regardless of call interleaving).
function randn(rng) {
  let u1 = rng(), u2 = rng();
  if (u1 < 1e-12) u1 = 1e-12;
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

// Normal CDF (Abramowitz & Stegun 7.1.26 erf approximation).
function normalCdf(x) {
  const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t
                  - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x / 2);
  const cdf = 0.5 * (1 + (x >= 0 ? y : -y));
  return Math.min(1, Math.max(0, cdf));
}

function drawSe(rng, k, seLo, seHi) {
  const out = new Array(k);
  const lo = Math.log(seLo), hi = Math.log(seHi);
  for (let i = 0; i < k; i++) out[i] = Math.exp(lo + (hi - lo) * rng());
  return out;
}

function stepWeight(pOne, weights) {
  if (pOne < STEP_CUTS[0]) return weights[0];
  if (pOne < STEP_CUTS[1]) return weights[1];
  return weights[2];
}

// Return { yi, vi, info } for one published meta-analysis of observed size k.
export function generate(mu, tau2, k, scenario, rng,
                         { seLo = 0.10, seHi = 0.70, maxFactor = 400 } = {}) {
  const sd = Math.sqrt(tau2);
  if (scenario === 'none') {
    const se = drawSe(rng, k, seLo, seHi);
    const yi = se.map(s => mu + sd * randn(rng) + s * randn(rng));
    return { yi, vi: se.map(s => s * s),
             info: { nExamined: k, k, selFrac: 1, degenerate: false } };
  }

  const kind = scenario.endsWith('weak') ? 'weak' : 'strong';
  const isStep = scenario.startsWith('step');
  const weights = isStep ? STEP_WEIGHTS[kind] : null;
  const cp = isStep ? null : COPAS[kind];

  const keepY = [], keepSe = [];
  let nExamined = 0;
  const cap = maxFactor * k;
  while (keepY.length < k && nExamined < cap) {
    const b = Math.max(k, 64);
    const se = drawSe(rng, b, seLo, seHi);
    for (let i = 0; i < b; i++) {
      const eps = randn(rng);
      const theta = mu + sd * randn(rng);
      const y = theta + se[i] * eps;
      let publish;
      if (isStep) {
        const pOne = 1 - normalCdf(y / se[i]);   // one-sided p (favours +)
        publish = rng() < stepWeight(pOne, weights);
      } else {
        const d = cp.rho * eps + Math.sqrt(1 - cp.rho * cp.rho) * randn(rng);
        const z = cp.g0 + cp.g1 / se[i] + d;
        publish = z > 0;
      }
      nExamined++;
      if (publish) {
        keepY.push(y); keepSe.push(se[i]);
        if (keepY.length >= k) break;
      }
    }
  }

  const degenerate = keepY.length < k;
  while (keepY.length < k) {           // top up so downstream always sees k
    const s = Math.exp(Math.log(seLo) + (Math.log(seHi) - Math.log(seLo)) * rng());
    keepY.push(mu + sd * randn(rng) + s * randn(rng));
    keepSe.push(s);
  }

  const yi = keepY.slice(0, k);
  const vi = keepSe.slice(0, k).map(s => s * s);
  return { yi, vi, info: { nExamined, k, selFrac: k / Math.max(1, nExamined), degenerate } };
}
