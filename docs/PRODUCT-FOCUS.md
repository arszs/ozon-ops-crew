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
