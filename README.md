# CostEffMA — Cost-Effectiveness Meta-Analysis

Browser-based tool for pooling cost-effectiveness data from multiple economic evaluations. Single-file HTML dashboard with no external dependencies.

## Features

- **NMB Forest Plot**: Net Monetary Benefit pooled via DerSimonian-Laird random-effects with HKSJ correction
- **ICER Analysis**: Incremental Cost-Effectiveness Ratio pooled on log scale with delta-method SE, back-transformed via exp()
- **CEAC**: Cost-Effectiveness Acceptability Curve showing P(cost-effective) across WTP thresholds
- **CE Plane**: Scatter plot with quadrant labels (Dominant/Dominated/Trade-off) and 95% confidence ellipse
- **WTP Slider**: Real-time updates as willingness-to-pay threshold changes (0 to 200K)
- **Export**: SVG charts and CSV data for each analysis

## Input Format

CSV with columns: `Study, DeltaCost, SE_Cost, DeltaEffect, SE_Effect, [Correlation]`

- DeltaCost: incremental cost (treatment minus comparator)
- DeltaEffect: incremental effect (QALYs, LYs, etc.)
- Correlation: cost-effect correlation (default 0)

## Statistical Methods

- NMB = WTP * deltaEffect - deltaCost
- NMB variance = WTP^2 * var(dEffect) + var(dCost) - 2 * WTP * rho * SE_cost * SE_effect
- ICER pooled on natural log scale; SE via delta method
- CEAC uses pooled NMB and normal CDF (Phi function)
- Random-effects via DL with HKSJ adjustment for k >= 3

## Testing

```bash
cd C:\Models\CostEffMA
python -m pytest test_app.py -v
```

17 Selenium tests covering NMB calculation, ICER pooling, CEAC curves, CE plane rendering, edge cases (k=1, zero effect, cost-saving treatments), and export functionality.

## Author

Mahmood Ahmad, Tahir Heart Institute
