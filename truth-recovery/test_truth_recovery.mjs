// ============================================================
// test_truth_recovery.mjs — assertions for costeffma's CE pooling engine.
// Run: node test_truth_recovery.mjs   (exit 0 = pass)
// ============================================================
import { runINBCell, runICERProbe } from './harness.mjs';
import { calcNMB, calcICER, dlPool } from './engine.mjs';

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  PASS  ${name}  ${detail ?? ''}`); }
  else      { failed++; console.log(`  FAIL  ${name}  ${detail ?? ''}`); }
}

// --- 1. Engine sanity: calcNMB is the linear net-benefit difference. ---
{
  const n = calcNMB({ deltaCost: 3000, seCost: 1000, deltaEffect: 0.2,
                      seEffect: 0.05, corr: 0 }, 25000);
  // INB = 25000*0.2 - 3000 = 2000; var = 25000^2*0.05^2 + 1000^2 = 2.5e6
  check('calcNMB linear net benefit', Math.abs(n.nmb - 2000) < 1e-6,
    `nmb=${n.nmb}`);
}

// --- 2. calcICER GUARDS the quadrant boundary (returns null for dEffect<=0). ---
{
  const bad = calcICER({ deltaCost: 3000, seCost: 1000, deltaEffect: -0.1,
                         seEffect: 0.05, corr: 0 });
  check('calcICER drops dEffect<=0 (no quadrant-flip pooling)', bad === null,
    `returned=${bad}`);
}

const nSim = 4000, seed = 777;

// --- 3. INB pooling RECOVERS the true population INB (CI covers truth). ---
const inb = runINBCell({ k: 8, muCost: 3000, muEffect: 0.20, sdCostHet: 800,
  sdEffectHet: 0.05, seCost: 1200, seEffect: 0.06, corr: 0.3, nSim, seed });
check('INB 95% CI covers true INB >= 93% of the time', inb.coverage >= 0.93,
  `coverage=${(inb.coverage*100).toFixed(1)}%  trueINB=£${inb.trueINB}`);
check('INB pooled estimate ~unbiased (|bias| < £200)', Math.abs(inb.meanBias) < 200,
  `bias=£${inb.meanBias.toFixed(0)}`);

// --- 4. ICER ratio pathology: near the quadrant boundary the engine DROPS a
//        large fraction of studies AND the surviving pooled ICER is severely
//        biased downward vs the true ICER (honest negative — do not trust ICER
//        pooling near dEffect=0; pool INB instead). ---
const trueICER = 3000 / 0.02; // = 150000
const probe = runICERProbe({ k: 8, muCost: 3000, muEffect: 0.02, sdEffectHet: 0,
  seCost: 1200, seEffect: 0.06, corr: 0.3, nSim, seed });
check('near boundary, engine drops >= 25% of studies', probe.dropFrac >= 0.25,
  `dropped=${(probe.dropFrac*100).toFixed(1)}%`);
check('pooled ICER severely understates true ICER near boundary',
  probe.medICER < 0.6 * trueICER,
  `medPooledICER=£${probe.medICER.toFixed(0)} vs trueICER=£${trueICER}`);

console.log(`\n${passed} passed, ${failed} failed.`);
process.exit(failed === 0 ? 0 : 1);
