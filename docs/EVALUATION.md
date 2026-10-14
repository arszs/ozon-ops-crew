# Evidence and contest readiness

Status: **not contest-ready**. The product reads real Ozon data and implements reviewed price/CPO workflows, but a complete real experiment and a paired 10-SKU seller pilot have not been demonstrated. Automated tests and synthetic examples do not establish commercial value.

Verified on 2026-10-14 against the local runtime, source code and published demo. Private store records remain in ignored `runtime/`; no seller identifiers, SKU-level finances or credentials are published here.

## Evidence by requirement

| Requirement | Verified evidence | Remaining gap |
|---|---|---|
| Business problem — 15% | Chinese workspace; SKU costs, missing-cost decisions and experiment workflow | A named/consenting target seller, measured current process, observed time/losses; seller profile not independently confirmed |
| Agent solution — 25% | Deterministic economics; source-bound plans; price/CPO tool adapters; separate confirmation and execution; audit hashes; real subscription-generated content | One complete real decision with all costs, actual approval, API receipt, readback and outcome |
| Working demo — 20% | Public Chinese AIGC → review → synthetic profit comparison; private Ozon reads; source and launch instructions | Public demo is not a connected store. Main price/advertising scenario still needs a repeatable completed case |
| Proven effect — 25% | Real read-only Ozon data; 10 real SKU selected privately for a pilot, frozen snapshot hash checked; actual subscription latency on synthetic input | Zero paired manual/assisted measurements; zero completed real experiments; no measured profit uplift or time saving |
| Difference/extension — 10% | Link between SKU economics, experimental conditions and exact reviewed action; preliminary WB and localization preserved | Same-input comparison against seller's current process and an available competitor |
| Safety — 5% | Server-only keys; explicit payload confirmation; stale-context checks; unknown-write handling; audit; no automatic replay | Account-specific write permission must still be validated by an approved real action; production authentication/tenancy remain unfinished |

## Current real evidence and its limits

- Seller and Performance connections are configured. The cached Ozon snapshot covers 2026-10-07 through 2026-10-13 (Moscow dates), fetched on 2026-10-14. The loaded activity sample contains 50 rows; this is **not a complete catalogue export**.
- Three completed finance reads cover the same one SKU and period, not three independent pilot cases. One completed advertising read also covers one SKU. No seller cost reconciliation is saved.
- One account-wide CPO source returned `performance_http_404`. Other successful sources do not erase this coverage gap; observed zero advertising spend is not sufficient proof of complete zero spend.
- The current workspace has no saved real cost profiles, real experiment plans or real results. Existing completed operations are synthetic publication/reply demonstrations. There is no evidence of a real price or advertising write in this workspace.
- Ten real SKU are prepared privately for the measurement protocol. Eight have positive observed stock; two have zero stock and belong in an availability-review task, not an active selling experiment. Selection is a convenience sample from loaded activity, not representative of the whole store.
- A fresh read-only price preflight on all eight positive-stock cohort items succeeded: all eight have automatic promotions not disabled; one also has a different marketing price. None currently qualifies for the implemented isolated price workflow. These are observed API constraints, not evidence that the seller should disable promotions. The all-assortment CPO report was retried once and still returned HTTP 404; its documented method/path were reconfirmed in the official documentation. The cause of the 404 remains unknown.
- Product detail now offers an explicit price/promotion read before costs or a plan. Read attempts, context, blockers and hashes persist; no operation or approval is created. The home view points zero-stock items to availability and previously checked promotion conflicts to review.

## Measurement protocol

See [PILOT-PROTOCOL.md](PILOT-PROTOCOL.md). The private cohort and immutable source copy are in `runtime/pilot-2026-10-14/`. They are not committed and are not served by GitHub Pages.

For each SKU, compare the same decision task using the same frozen inputs in the seller's existing process and in Ops Crew. Record active human time separately from elapsed tool time, corrections, completeness, decision and source references. Missing measurements stay null. Use counterbalanced task order where practical and report learning/order effects. Do not count the subscription's full monthly fee as per-task cost or claim zero incremental cost without a documented basis.

Commercial effect remains unverified until an approved experiment completes both periods, actual execution is checked and all costs are reconciled. An observed difference in daily contribution remains observational, with stock, promotions, seasonality and delayed expenses disclosed. Time saving can be reported independently if paired human measurements exist.

## Actual generated-artifact evidence

[AIGC-DEMO-EVIDENCE.json](AIGC-DEMO-EVIDENCE.json) records generated image hashes and a real text call on synthetic data. [AIGC-QUEUE-EVIDENCE.json](AIGC-QUEUE-EVIDENCE.json) records one real subscription call: HTTP acceptance in 3 ms, completion observed after 25.06 s with 5-second polling. This is neither user time saved nor a real-SKU benchmark. xds.studio is currently manual; native API access is unverified.

## Judge verification path

1. Open the [Chinese public demo](https://arszs.github.io/ozon-ops-crew/). Review the synthetic source, real generated before/after images and approval checks. In the profit example, raise test-period costs to 48,000 RUB: more orders must not become a positive profit conclusion. Clear a cost or confirmation: the demo must reject or withhold a conclusion.
2. Use the current source branch `feat/cross-border-workspace` ([PR #1](https://github.com/arszs/ozon-ops-crew/pull/1)); see [SPECS.md](SPECS.md) for the core workflow and exact boundaries. The default branch also retains historical simulator code; it is not the current connected workspace.
3. Run `npm ci`, `npm test`, then `npm start` with Node >=22.13. Open the local Chinese workspace. Real reads require an authorized local connection; do not distribute credentials or expose the local service publicly.
4. Inspect the local audit and source-bound plan, approval, receipt and result records. Synthetic test receipts cannot stand in for real platform execution.
5. Review measured pilot records only when completed and consented for disclosure. Until then, score the evidence gap as unfinished, not as inferred success.

## Stop conditions and limits

Plan budgets and maximum loss are stored and checked against read evidence; monitoring may flag overspend. They are **not automatic platform spend caps or guaranteed automatic stops**. Price changes and CPO switches require separate human confirmation and execution. Cancellation does not restore platform settings. Unknown results require readback, not a blind retry. See [LIVE-API.md](LIVE-API.md) for adapter scope.
