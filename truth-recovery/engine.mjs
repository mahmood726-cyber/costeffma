/* ============================================================================
   costeffma — VERBATIM extraction of the pooling engine for truth-recovery.
   Source: index.html. Functions copied with ZERO edits to statistical logic:
     phi (177-185), qt (188-195), qnorm (197-236), calcNMB (260-267),
     dlPool (270-319), calcICER (322-336).
   Only additions: this header and the export block at the end.
   ============================================================================ */

function phi(z) {
  // Standard normal CDF (Abramowitz & Stegun approximation)
  const a1=0.254829592, a2=-0.284496736, a3=1.421413741, a4=-1.453152027, a5=1.061405429, p=0.3275911;
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1.0 / (1.0 + p * x);
  const y = 1.0 - (((((a5*t + a4)*t) + a3)*t + a2)*t + a1)*t * Math.exp(-x*x);
  return 0.5 * (1.0 + sign * y);
}

function qt(p, df) {
  // Use normal approximation adjusted for df
  const z = qnorm(p);
  if (df > 100) return z;
  const g1 = (z*z*z + z) / (4*df);
  const g2 = (5*z*z*z*z*z + 16*z*z*z + 3*z) / (96*df*df);
  return z + g1 + g2;
}

function qnorm(p) {
  // Rational approximation of inverse normal CDF
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  if (p === 0.5) return 0;
  const a = [
    -3.969683028665376e1, 2.209460984245205e2,
    -2.759285104469687e2, 1.383577518672690e2,
    -3.066479806614716e1, 2.506628277459239e0
  ];
  const b = [
    -5.447609879822406e1, 1.615858368580409e2,
    -1.556989798598866e2, 6.680131188771972e1,
    -1.328068155288572e1
  ];
  const c = [
    -7.784894002430293e-3, -3.223964580411365e-1,
    -2.400758277161838e0, -2.549732539343734e0,
    4.374664141464968e0, 2.938163982698783e0
  ];
  const d = [
    7.784695709041462e-3, 3.224671290700398e-1,
    2.445134137142996e0, 3.754408661907416e0
  ];
  const pLow = 0.02425, pHigh = 1 - pLow;
  let q, r;
  if (p < pLow) {
    q = Math.sqrt(-2*Math.log(p));
    return (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) /
           ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
  } else if (p <= pHigh) {
    q = p - 0.5; r = q*q;
    return (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5])*q /
           (((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1);
  } else {
    q = Math.sqrt(-2*Math.log(1-p));
    return -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) /
            ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
  }
}

function calcNMB(s, wtp) {
  const nmb = wtp * s.deltaEffect - s.deltaCost;
  // var(NMB) = WTP^2 * var(dEffect) + var(dCost) - 2*WTP*cov(cost,effect)
  const cov = s.corr * s.seCost * s.seEffect;
  const varNMB = wtp*wtp * s.seEffect*s.seEffect + s.seCost*s.seCost - 2*wtp*cov;
  const seNMB = Math.sqrt(Math.max(0, varNMB));
  return { nmb, seNMB, varNMB: Math.max(0, varNMB) };
}

// ---- DerSimonian-Laird Random Effects ----
function dlPool(estimates, variances) {
  const k = estimates.length;
  if (k === 0) return null;
  if (k === 1) {
    return {
      pooled: estimates[0], se: Math.sqrt(variances[0]),
      ci_lo: estimates[0] - 1.96*Math.sqrt(variances[0]),
      ci_hi: estimates[0] + 1.96*Math.sqrt(variances[0]),
      tau2: 0, I2: 0, Q: 0, k: 1, weights: [1]
    };
  }
  const w = variances.map(v => v > 0 ? 1/v : 0);
  const sumW = w.reduce((a,b) => a+b, 0);
  if (sumW === 0) return null;
  const thetaFE = w.reduce((s, wi, i) => s + wi*estimates[i], 0) / sumW;
  const Q = w.reduce((s, wi, i) => s + wi*(estimates[i] - thetaFE)**2, 0);
  const sumW2 = w.reduce((s, wi) => s + wi*wi, 0);
  const C = sumW - sumW2/sumW;
  let tau2 = Math.max(0, (Q - (k-1)) / C);
  // Guard against zero total variance (v=0 and tau2=0) which would yield
  // an infinite weight and poison the pooled estimate.
  const wRE = variances.map(v => (v + tau2) > 0 ? 1 / (v + tau2) : 0);
  const sumWRE = wRE.reduce((a,b) => a+b, 0);
  const pooled = wRE.reduce((s, wi, i) => s + wi*estimates[i], 0) / sumWRE;
  const se = Math.sqrt(1 / sumWRE);
  // I-squared
  const I2 = Q > (k-1) ? ((Q - (k-1)) / Q) * 100 : 0;
  // Use t-distribution for CI when k < 30 (HKSJ-like)
  let tCrit;
  if (k >= 3) {
    // HKSJ adjustment
    const qAdj = Math.max(1, Q / (k - 1));
    const seAdj = se * Math.sqrt(qAdj);
    tCrit = Math.abs(qt(0.025, k - 1));
    return {
      pooled, se: seAdj,
      ci_lo: pooled - tCrit * seAdj,
      ci_hi: pooled + tCrit * seAdj,
      tau2, I2, Q, k,
      weights: wRE.map(wi => wi / sumWRE)
    };
  }
  return {
    pooled, se,
    ci_lo: pooled - 1.96 * se,
    ci_hi: pooled + 1.96 * se,
    tau2, I2, Q, k,
    weights: wRE.map(wi => wi / sumWRE)
  };
}

// ---- ICER pooling (log scale) ----
function calcICER(s) {
  if (s.deltaEffect <= 0) return null;
  const icer = s.deltaCost / s.deltaEffect;
  // Only valid if ICER > 0 (deltaCost > 0 and deltaEffect > 0)
  if (icer <= 0) return null;
  const logICER = Math.log(icer);
  // SE(log_ICER) via delta method
  const term1 = (s.seCost / s.deltaCost) ** 2;
  const term2 = (s.seEffect / s.deltaEffect) ** 2;
  const term3 = 2 * s.corr * (s.seCost * s.seEffect) / (s.deltaCost * s.deltaEffect);
  const varLogICER = term1 + term2 - term3;
  if (varLogICER < 0) return null;
  const seLogICER = Math.sqrt(varLogICER);
  return { icer, logICER, seLogICER, varLogICER };
}

export { phi, qt, qnorm, calcNMB, dlPool, calcICER };
