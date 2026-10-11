# Evaluation and evidence

## Competition rubric mapping
| Criterion | Weight | Evidence in this repository |
|---|---:|---|
| Business problem | 15% | Chinese seller / Russia, FBO/FBS; SUBMISSION.zh.md §1–2 |
| Agent technical design | 25% | ARCHITECTURE.md, deterministic engine, contracts and limits |
| Usable interactive demo | 20% | RU/CN portal, scenario controls, CSV import, settings, audit |
| Business value | 25% | Explicit measurement plan below; no fabricated uplift |
| Innovation/scalability | 10% | Joint ads/price/inventory decisions, batch currency model |
| Safety/compliance | 5% | Read-only allowlist, secret isolation, no external writes |

## Automated checks
`npm test`: negative rolling profit including advertising; unsettled fees; low-sample season guard; expensive storage; stockout/replenishment; invalid policy; profit floor vs price cap; currency calculation. CI executes the same tests.

## Pilot plan
1. Collect and reconcile at least one full settlement cycle; classify orders/returns/fees by SKU and batch.
2. Run recommendations in shadow mode. Measure calculation reconciliation error and operator review time.
3. Approve SKU-level price and spend bounds. Test a small cohort with comparable untreated SKUs or switchback periods. Keep promotion and stockout confounding visible.
4. Measure contribution profit after allocated ads and storage, total profit, inventory days, ad spend with zero orders, safety-trip confirmation latency and manual minutes per decision.
5. Publish sample counts, observation dates, attribution windows and uncertainty; do not infer price elasticity from a few transactions.

## Current evidence
Synthetic deterministic scenarios pass automated checks. Seller catalog read access validated on the owner's local account. No real profit uplift, forecasting accuracy, campaign-pause success or time savings measured yet.

## Manual acceptance
- RU/CN switch updates portal labels.
- Change storage cost and observe hold/clear changes.
- Persist policy, reload, verify limits.
- Simulate stop: journal entry says simulation, never executed remotely.
- Malformed/unknown-SKU CSV rejected without partial update.
- Public demo exposes no live catalog or credentials.

## Version 0.3 — economics-driven advertising loop
The Autopilot screen runs a deterministic agent workflow every 30 seconds while the browser tab is open: data validation → unit economics → stock constraints → budget allocation → risk checks → local simulated campaign execution → receipts. Repeated unchanged decisions are idempotent. Data older than one hour pauses the simulated campaigns. Reload does not auto-resume the loop. 22 automated tests pass.

This is an executable competition demonstration, not live Ozon advertising automation. Real activation requires separately verified Performance API access, complete actual costs, campaign membership checks, a persistent server worker and merchant-approved operating limits. No live uplift is claimed.
