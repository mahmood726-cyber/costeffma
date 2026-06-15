# Truth-Recovery Validation — costeffma

**Repo:** mahmood726-cyber/costeffma (Cost-Effectiveness Meta-Analysis)
**Engine:** index.html (924 lines) — genuine CE meta-analysis engine (NMB/INB forest, ICER forest, CEAC, CE plane).
**Date:** 2026-06-15

## Verdict

**GENUINE METHODS ENGINE — VALIDATED. INB pooling recovers truth; ICER pooling is correctly guarded but is NOT truth-recovering near the quadrant boundary (honest negative, by design of the ratio).**

The engine pools the incremental net (monetary) benefit INB = WTP*dEffect - dCost (a well-behaved DIFFERENCE) via calcNMB + DerSimonian-Laird (dlPool, with an HKSJ-like t/Q adjustment). It also offers an ICER forest, but calcICER pools log(ICER) and explicitly GUARDS the quadrant boundary: it returns null whenever dEffect <= 0 or ICER <= 0, so it never naively pools a ratio across the sign change. That guard is the correct defensive choice (no quadrant-flip pooling, no NaN), but dropping the boundary-crossing studies makes the surviving pooled ICER biased near dEffect = 0.

## Method

Pooling functions extracted **verbatim** from index.html (phi, qt, qnorm, calcNMB, dlPool, calcICER) into engine.mjs (only additions: header + export block; zero edits to statistical logic). A seeded bivariate (dCost, dEffect) DGP injects a known true population mean -> known true INB at a WTP and known true ICER. The repo's OWN engine then pools each simulated CE meta-analysis (4,000 sims/cell, WTP = £25,000).

## Results

### [A] INB (net benefit) coverage — true INB = £2000, WTP = £25,000

| k | Coverage | Mean width | Bias |
|---|---|---|---|
| 5  | 97.7% | £9,201 | -£34 |
| 8  | 97.5% | £6,112 | -£30 |
| 15 | 97.8% | £4,028 | -£27 |

INB pooling **recovers the true INB**: coverage ~97.5-97.8% (slightly conservative — the HKSJ/Q adjustment errs on the wide side, the correct direction), bias essentially zero (< £35 on a £2000 truth).

### [B] ICER ratio pathology — muCost = £3000 fixed, true dEffect -> 0

| true muEffect | true ICER | studies dropped | median pooled ICER | 90% range |
|---|---|---|---|---|
| 0.20 | £15,000  | 0.7%  | £16,359 | [£12,755, £20,540] |
| 0.10 | £30,000  | 5.5%  | £24,980 | [£18,588, £34,380] |
| 0.05 | £60,000  | 20.9% | £31,893 | [£21,768, £50,485] |
| 0.02 | £150,000 | 37.3% | £37,601 | [£23,090, £73,955] |

As the true effect shrinks toward 0 the true ICER explodes (£15k -> £150k), but the engine (a) discards an increasing fraction of studies (0.7% -> 37.3%) via the calcICER guard, and (b) the surviving log-ICER pool plateaus around £25-38k — **severely understating** the true ICER (£37,601 vs £150,000, a 4x understatement at muEffect=0.02). The 90% range never gets near the truth.

## Findings

1. **INB/NMB pooling is honest and truth-recovering** — unbiased, near-nominal (slightly conservative) coverage at all k. The CEAC and CE-plane outputs are built on this same well-behaved difference. This is the path the engine should (and does) foreground.
2. **calcICER correctly guards the quadrant boundary** — returns null for dEffect <= 0 / ICER <= 0 rather than emitting a sign-flipped or infinite ratio. Good defensive coding; prevents NaN/quadrant-flip poisoning of the pool.
3. **Honest negative: the pooled ICER is NOT truth-recovering near dEffect = 0.** The guard's selection-by-discarding biases the surviving log-ICER pool downward (up to 4x understatement) and yields a falsely narrow range. This is an intrinsic property of the ICER ratio, not a coding bug — but it means the ICER forest must not be read as an unbiased pooled cost-effectiveness summary when effects are small or uncertain.

## Recommendation

Engine is sound; **keep INB/NMB/CEAC as the primary pooled summary** (validated truth-recovery). For the ICER forest, surface a warning when a non-trivial fraction of studies are dropped by the calcICER guard (e.g. dEffect CI crosses 0), and/or report the cost-effectiveness plane / a Fieller-type interval instead of a single pooled ICER near the boundary. Do not present the pooled ICER as an unbiased point estimate when effects are small. No correctness bug in the math; the ICER limitation is the known ratio pathology, handled defensively.

## Files

- engine.mjs — verbatim engine extraction + exports
- dgp-kit.mjs — seeded PRNG (makeRng reused from sweep kit)
- harness.mjs — INB coverage + ICER-boundary probe (run: node harness.mjs)
- test_truth_recovery.mjs — 6 assertions, all pass (run: node test_truth_recovery.mjs)
