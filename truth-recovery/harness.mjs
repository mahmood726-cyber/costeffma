// ============================================================
// harness.mjs — Truth-recovery harness for costeffma.
//
// Cost-effectiveness MA pools either:
//   (a) INB / NMB — a DIFFERENCE (wtp*dEffect - dCost). Well-behaved, normal.
//   (b) ICER       — a RATIO (dCost/dEffect). Ill-behaved when dEffect ~ 0:
//                    the ratio is discontinuous and flips quadrants.
//
// We inject a known true mean (dCost, dEffect) per study via a seeded
// bivariate DGP and ask costeffma's OWN engine (calcNMB + dlPool for INB;
// calcICER + dlPool for ICER) to pool. We then measure:
//   - INB: does the pooled 95% CI cover the TRUE population INB at a WTP?
//   - ICER: how does the engine behave as the true dEffect approaches 0
//           (the quadrant-boundary pathology)?
//
// makeRng (seeded PRNG) is reused verbatim from the sweep DGP kit.
// ============================================================
import { makeRng } from './dgp-kit.mjs';
import { calcNMB, dlPool, calcICER } from './engine.mjs';

const WTP = 25000; // £/QALY threshold for INB

// standard normal via Box-Muller on the seeded uniform stream
function randn(rng) {
  let u1 = rng(), u2 = rng();
  if (u1 < 1e-12) u1 = 1e-12;
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

// Generate k studies. Each study reports (dCost, seCost, dEffect, seEffect, corr)
// drawn around a true population mean (muCost, muEffect) with study-level
// heterogeneity sdCostHet/sdEffectHet and within-study sampling SE.
// TRUE population INB at WTP = WTP*muEffect - muCost.
function genStudies(rng, { k, muCost, muEffect, sdCostHet, sdEffectHet,
                           seCost, seEffect, corr }) {
  const studies = [];
  for (let i = 0; i < k; i++) {
    // true per-study means (random-effects draw)
    const tCost = muCost + sdCostHet * randn(rng);
    const tEffect = muEffect + sdEffectHet * randn(rng);
    // observed estimate = true per-study mean + within-study sampling error
    const dCost = tCost + seCost * randn(rng);
    const dEffect = tEffect + seEffect * randn(rng);
    studies.push({ deltaCost: dCost, seCost, deltaEffect: dEffect, seEffect, corr });
  }
  return studies;
}

// One INB coverage run: returns whether pooled 95% CI covers the true INB.
export function runINBCell({ k, muCost, muEffect, sdCostHet, sdEffectHet,
                            seCost, seEffect, corr, nSim, seed }) {
  const rng = makeRng(seed);
  const trueINB = WTP * muEffect - muCost;
  let covered = 0, n = 0, widthSum = 0, biasSum = 0;
  for (let s = 0; s < nSim; s++) {
    const studies = genStudies(rng, { k, muCost, muEffect, sdCostHet,
                                      sdEffectHet, seCost, seEffect, corr });
    const nmb = studies.map(st => calcNMB(st, WTP));
    const pool = dlPool(nmb.map(x => x.nmb), nmb.map(x => x.varNMB));
    if (!pool || !isFinite(pool.pooled)) continue;
    n++;
    if (trueINB >= pool.ci_lo && trueINB <= pool.ci_hi) covered++;
    widthSum += (pool.ci_hi - pool.ci_lo);
    biasSum += (pool.pooled - trueINB);
  }
  return { trueINB, coverage: covered / n, meanWidth: widthSum / n,
           meanBias: biasSum / n, n };
}

// ICER-pathology probe: as true dEffect -> 0, how many studies survive the
// engine's calcICER guard (it returns null for dEffect<=0 or icer<=0)?
// This shows whether the engine naively pools across the quadrant boundary
// (it does NOT — it drops sign-crossing studies) and how unstable the
// surviving pooled ICER becomes.
export function runICERProbe({ k, muCost, muEffect, sdEffectHet,
                              seCost, seEffect, corr, nSim, seed }) {
  const rng = makeRng(seed);
  let dropped = 0, total = 0, poolFail = 0, poolOK = 0;
  const pooledICERs = [];
  for (let s = 0; s < nSim; s++) {
    const studies = genStudies(rng, { k, muCost, muEffect, sdCostHet: 0,
                                      sdEffectHet, seCost, seEffect, corr });
    const ic = [];
    for (const st of studies) {
      total++;
      const r = calcICER(st);
      if (r === null) { dropped++; continue; }
      ic.push(r);
    }
    if (ic.length < 2) { poolFail++; continue; }
    const pool = dlPool(ic.map(x => x.logICER), ic.map(x => x.varLogICER));
    if (!pool || !isFinite(pool.pooled)) { poolFail++; continue; }
    poolOK++;
    pooledICERs.push(Math.exp(pool.pooled));
  }
  pooledICERs.sort((a, b) => a - b);
  const med = pooledICERs.length ? pooledICERs[Math.floor(pooledICERs.length / 2)] : NaN;
  const p05 = pooledICERs.length ? pooledICERs[Math.floor(pooledICERs.length * 0.05)] : NaN;
  const p95 = pooledICERs.length ? pooledICERs[Math.floor(pooledICERs.length * 0.95)] : NaN;
  return { dropFrac: dropped / total, poolFailFrac: poolFail / nSim,
           medICER: med, p05ICER: p05, p95ICER: p95, poolOK };
}

if (process.argv[1] && process.argv[1].endsWith('harness.mjs')) {
  console.log('costeffma truth-recovery harness');
  console.log('='.repeat(78));

  // INB: true muEffect=0.20 QALY, muCost=£3000 -> true INB = 25000*0.2-3000 = £2000
  console.log('\n[A] INB (net benefit) coverage — true INB = £2000, WTP=£25000');
  for (const k of [5, 8, 15]) {
    const r = runINBCell({ k, muCost: 3000, muEffect: 0.20, sdCostHet: 800,
      sdEffectHet: 0.05, seCost: 1200, seEffect: 0.06, corr: 0.3,
      nSim: 4000, seed: 777 });
    console.log(`  k=${String(k).padStart(2)}  coverage=${(r.coverage*100).toFixed(1)}%` +
      `  width=£${r.meanWidth.toFixed(0)}  bias=£${r.meanBias.toFixed(0)}  (trueINB=£${r.trueINB})`);
  }

  // ICER pathology: hold muCost, shrink true muEffect toward 0 so dEffect
  // increasingly crosses 0 -> the ratio explodes / flips quadrant.
  console.log('\n[B] ICER ratio pathology — muCost=£3000 fixed, true dEffect -> 0');
  console.log('    (true ICER = 3000/muEffect; engine drops dEffect<=0 studies)');
  for (const muEffect of [0.20, 0.10, 0.05, 0.02]) {
    const trueICER = 3000 / muEffect;
    const r = runICERProbe({ k: 8, muCost: 3000, muEffect, sdEffectHet: 0,
      seCost: 1200, seEffect: 0.06, corr: 0.3, nSim: 4000, seed: 777 });
    console.log(`  muEffect=${muEffect.toFixed(2)} (trueICER=£${trueICER.toFixed(0)})` +
      `  studiesDropped=${(r.dropFrac*100).toFixed(1)}%` +
      `  medPooledICER=£${isFinite(r.medICER)?r.medICER.toFixed(0):'NA'}` +
      `  90%range=[£${isFinite(r.p05ICER)?r.p05ICER.toFixed(0):'NA'},£${isFinite(r.p95ICER)?r.p95ICER.toFixed(0):'NA'}]`);
  }
}
