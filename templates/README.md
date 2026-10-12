# Excel input templates

Open CSV in Excel using UTF-8 and comma delimiter. All supplied rows are synthetic examples.

`procurement-scenario.csv` is directly importable into the portal. It updates existing SKUs, persisted in this browser. Values are per unit except stock and incoming quantity. Unknown SKUs and invalid numeric values are rejected.

`purchase-batches.csv` is an optional stock-batch example, not imported by the portal. Costs are supplied directly in RUB; no inbound cost or exchange rate is calculated.

Do not enter computed loss as purchase cost: realized profit comes from actual sales, fees and advertising. Include actual taxes in total sales costs.

## Version 0.2 imports

`products.json` is a validated full-product replacement template. Export it first for a backup; import replaces products only, not policies or audit. IDs allow ASCII letters, digits, underscore, dot and hyphen. Commission is a fraction below 1; all costs are per unit in RUB; unitCost is the direct product cost.

`sales-window.csv` replaces sales for listed SKUs, oldest first. It does not append, so reimport is idempotent. `total_cost_rub` includes purchase, commission, fulfilment, storage, taxes and returns, excluding advertising. `allocated_ads_rub` must not be included in total cost. `settled` is 0 or 1. `unallocated_ads_rub` is additional spend within the same observation window, summed over rows, never duplicated in allocated ads. Zero-order ad rows use zero sales fields. The configured last-N filter applies to sales; the extra spend field is a conservative whole-window guard and is not automatically time-aligned.

Do not put customer information or secrets in imports. Data and exported files remain commercially sensitive. These imports are standardized templates, not direct ingestion of every Ozon export format.
