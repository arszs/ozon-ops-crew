# Excel input templates

Open CSV in Excel using UTF-8 and comma delimiter. All supplied rows are synthetic examples.

`procurement-scenario.csv` is directly importable into the portal. It updates existing demo SKUs only, in browser memory. Values are per unit except stock and incoming quantity. Unknown SKUs and invalid numeric values are rejected.

`purchase-batches.csv` defines the planned production batch ledger; it is not yet importable into the portal. Keep one row per purchase batch, not one aggregate row per SKU. Purchase currency is CNY; converted cost is RUB. Unit acquisition cost = (purchase_total_cny × fx_rub_per_cny + inbound_total_rub + other_total_rub) / quantity. A production import must handle partial receipts, allocation and immutable historic rates.

Do not enter computed loss as purchase cost: realized profit comes from actual sales, fees and advertising. Record taxes/duties as explicit cost fields before production reconciliation.
