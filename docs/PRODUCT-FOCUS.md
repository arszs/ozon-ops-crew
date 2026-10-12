# Product focus after Miaoshou comparison

## Positioning hypothesis

A Chinese seller needs to decide which SKU, price and advertising setup deserves further investment on Ozon/WB. Generic translation, listing, ERP dashboards and an AI analyst already overlap with Miaoshou. Our proposed focus is a transparent experimental workflow tied to SKU contribution profit. Differentiation is a hypothesis, not a verified exclusive capability.

Official competitor evidence reviewed: [Ozon listing](https://erp.91miaoshou.com/ozon.html), [advertising](https://erp.91miaoshou.com/help_center/article_9092.html), [profit accounting](https://erp.91miaoshou.com/help_center/article_9412.html), [AI analyst](https://erp.91miaoshou.com/help_center/article_14740.html). No authenticated competitor usability test performed.

## Delivered in this iteration

Chinese portal has 商品利润实验. Users choose a store and SKU and record two dated, non-overlapping periods, including all product revenue (organic included), non-ad costs and separate ad costs. Daily contribution is normalized by calendar days. Records persist in the workspace with an audit hash. Manual observations are explicitly distinguished from API verification and isolated by store/mode.

Positive difference is only a repeat-test candidate. Unsettled costs/revenue, fewer than 30 orders in either period, or unconfirmed comparability block the directional verdict. Thirty orders is a screening heuristic, not statistical significance. Sequential observations do not establish causality. No external operations are triggered.

## Remaining work toward the original product

- Join actual SKU financial transactions and advertising expenses with seller-supplied product costs; reconcile fees, refunds and date attribution before labelling profit complete.
- Define prospective plans and API capability checks per account, human-approved execution, budget enforcement, stop conditions and reconciliation.
- Account for attribution delays, promotions, stockouts and seasonality; provide uncertainty with sufficient daily observations, not aggregate-only invented confidence.
- Connect Taobao or genuine exports, validate WB access and complete gated operations from the MVP specification.
- Assess shop entry only with explicit cost assumptions and demand evidence, followed by a small pilot.
- Run the competition benchmark on 10 genuine SKUs against both manual work and Miaoshou: human editing time, total elapsed time, field correction rate, moderation outcome and actual compute cost. No improvement claim until measured.

For a short demo: show store overview, a clearly labelled synthetic migration, the approval gates, and a saved manual profit observation with its evidence blockers. Do not present simulated publishing or observational profit differences as real commercial outcomes.

The Chinese 商品与广告 page now reads the existing live Ozon snapshot, supports SKU/name/offer search and opens the observation form with the correct primary store and SKU. Ordered units are not labelled order count. Accruals retain their currency and are not converted into profit. Partial sources, stale snapshots and unallocated charges remain visible. No automatic financial prefill: these inputs have incompatible accounting bases until reconciliation is implemented. Browser verification against the current snapshot showed zero SKU rows; this is an empty/partial-data state, not a claim of no sales.

Snapshot reliability fix: a products enrichment loop with zero SKU inputs used to report success even when all four primary API sources failed. It now reports skipped; the cache accepts only snapshots with at least one successful primary source. Failed refreshes preserve the prior usable snapshot on disk and in memory. Previously saved enrichment-only snapshots are rejected on startup. Regression tests cover failure on first load and failure after a successful refresh.

## Prospective plans

商品利润实验 now supports persisted plans: store/SKU, one lever, baseline/variant, hypothesis, control conditions, non-overlapping dated periods, test-period ad budget and maximum total loss. Only one unfinished plan per store/SKU is allowed. Plans may be cancelled; cancellation is idempotent and has an audit event. Linked observations must match the original store, SKU, lever, variants and dates. A completed plan cannot accept another result. Budget/loss breaches are flagged and block a positive recommendation. Plan timestamps are shown so a retrospectively entered plan is not mistaken for preregistration. These are manual monitoring limits, not automated marketplace enforcement.

Validation: 79 automated tests pass, including persistence, cross-store rejection, mismatched observations, duplicate completion and cancellation. Chinese plan form inspected in Chrome on the local server. No real advertising or price write was performed.

## Home decision queue

Home now combines actual Ozon headline metrics with a decision queue derived from loaded experiment plans and each store/SKU's latest observation. It separates DEMO decisions, links directly to the record, prioritizes missing evidence and negative profit, and distinguishes expired planned dates from actual execution. A positive change with still-negative daily contribution is shown as a loss review, not a scale recommendation. Overlapping observations are never summed into store profit. The fourth headline metric is now available advertising spend with coverage disclosure; benchmark claims remain in project documentation instead of occupying store economics. Stale/error snapshots are labelled on home as well as the product page.

## Catalogue coverage

Live synchronization now reads product catalogue pages (100 per page, bounded to 100 pages), rejects looping cursors/changing totals/incomplete pages, deduplicates product IDs and loads product details by product ID before enriching report-only SKU rows. This makes zero-history catalogue products eligible for the product dashboard instead of relying only on sales/advertising membership. Products without a valid SKU are counted separately. Missing stock data remains unknown; skipped enrichment is not shown as an API failure.

Validation: 87 tests pass, including catalogue-only products when analytics/finance/ads fail. The live verification request failed with `UND_ERR_CONNECT_TIMEOUT`; full catalogue traversal is therefore not yet verified against the current account. The official Seller API documentation fetch also failed (redirect loop). Existing endpoint contracts are reused; no claim of a fresh official schema validation is made.

## Assortment-level entry assessment

Structured samples may now supply independent economics in each item's `targets.ozon` and `targets.wb`. The assessment counts conditional economic candidates, revise-cost/price items and missing inputs per marketplace, and displays every SKU separately. Store-level scenario fields never fill missing SKU costs. The per-order advertising allowance is calculated at a stated 15% contribution margin; it is not a bid or a forecast of achievable acquisition cost. A format example is explicitly synthetic and will not overwrite existing input. Evidence retains the per-SKU assumptions for auditing.

Validation: 90 tests passed, including platform-specific mixed assortments, missing costs, duplicate SKU rejection and the advertising allowance equation. No demand research, Taobao fetch or real pilot outcome is implied by this calculator.

## Form continuity

Failed actions preserve editable form values when the page and SKU job context remain the same. Background live refresh preserves home form inputs and product search. Values are held only temporarily in page memory; passwords/files are excluded, and successful actions retain normal reset behavior. Linked experiment plan IDs and their explanatory label survive validation failures. Chrome verification: submitting intentionally malformed import JSON displayed the error while retaining the exact draft and keeping the migration queue unchanged. Cross-page navigation and browser reload are not persistent draft storage.

## SKU cost profiles

Product economics now has persistent, store-scoped RUB cost profiles, with evidence/source text, immutable versions and optimistic revision checks. The seller supplies price, product cost, commission, fulfilment, allocated advertising per unit, taxes and returns reserve. Results are unit contribution and break-even price under these assumptions; they are not actual settled profit. API product rows open the matching cost profile (only an explicit RUB price is prefilled). Missing amounts are rejected, not coerced to zero, and saving never creates a marketplace operation. This is a foundation for experiment margin guards; API financial reconciliation and additional expense categories remain required before claiming complete store profit. Validation: 104 tests passed.

## Cost guard for price experiments

New price plans require the latest saved cost profile for the same store/SKU. The selected baseline must match that profile's assumed RUB price; target prices are numeric with at most two decimals. The seller selects minimum contribution margin (default 15%). Plans below the calculated cent-rounded-up minimum price are rejected, and the complete cost basis/version/source plus baseline and variant economics are frozen into the plan. Later cost edits do not rewrite historical plans. This neither verifies the current marketplace price nor executes it. Existing older plans are retained without retroactively claiming a cost check. Advertising plans remain manual hypotheses and do not yet receive an equivalent model-based guard. Validation: 106 tests pass.

## Multiple-store product workspace

The product page now switches between configured stores and keeps cost editing and observation shortcuts scoped to the selected store/SKU. The cost table also filters by the selected store. The primary Ozon account retains its detailed sales/finance/advertising view; WB and secondary Ozon accounts display their existing partial catalogue snapshots with explicit missing-data notices. They do not inherit primary-account sales or ad metrics. DEMO snapshots remain labelled. Secondary Ozon's existing product/list response contains product_id, not SKU: legacy snapshots are displayed with that identifier and cannot prefill a SKU experiment until SKU enrichment is implemented. No new API coverage or marketplace write is implied.

Repeated live polling no longer rebuilds the page when status, timestamp, staleness and error have not changed. This reduces disruption while using forms and selectors. Validation: 109 tests pass, including cross-store isolation and legacy identifier handling. Chrome verified WB DEMO selection and correct store/SKU prefill in both cost and observation forms; no data was submitted. Real WB credentials remain unavailable for account verification.

## Ozon catalogue enrichment for additional stores

Additional Ozon stores now use paginated product/list plus batches of product/info/list, through the existing throttled read-only caller. The snapshot distinguishes product_id, merchant offer_id and actual marketplace SKU, retains SKU aliases, currencies and per-SKU reported present stock, and marks products without SKU. An incomplete detail response, conflicting SKU owner, duplicate/unexpected product or pagination failure rejects the replacement snapshot; the previous snapshot remains available. Unknown amounts remain null. This supplies catalogue information, not sales/advertising or settled profit for additional stores.

Each configured secondary store now reads credentials only from its own envFile; missing values cannot silently inherit the primary account's process environment. The primary Ozon profile retains its existing credential configuration. Existing legacy snapshots remain visible with product_id labels until refreshed. Automated checks cover 101-product pagination, detail completeness, identity separation, unknown stock, store-specific credentials and preservation after failure. Full suite: 114 tests pass. The official documentation page again returned a redirect loop; the implementation reuses endpoint contracts already used by the primary-account integration.
