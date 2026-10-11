<div align="center">
<img src="web/mark.svg" width="84" alt="Ozon Ops Crew">

# Ozon Ops Crew
### China → Russia · Inventory-aware profit control
**价格 × 广告 × 库存，一体化利润决策**

[**Open interactive demo / 打开演示**](https://arszs.github.io/ozon-ops-crew/) · [中文参赛方案](docs/SUBMISSION.zh.md) · [Русское описание](docs/PROJECT.ru.md) · [Architecture](docs/ARCHITECTURE.md) · [Evaluation](docs/EVALUATION.md)

</div>

A control room for Chinese Ozon Global sellers: compare pricing and advertising strategies against stock, replenishment, storage costs and seasonal assumptions. Detect a rolling loss including advertising, freeze automated price changes and request a SKU-level advertising pause.

> **Prototype, not a production trading system.** All strategy and profit examples use synthetic data. The included local Seller API adapter reads the product catalog only. Price changes, advertising writes, automatic forecasting and production notifications are not implemented. No live performance improvement is claimed.

## Run in 30 seconds

Node.js 20+; no npm dependencies required.

```sh
npm test
npm start
# http://127.0.0.1:4173
```

For read-only catalog access, put `OZON_CLIENT_ID` and `OZON_API_KEY` in a file **outside this repository**, restrict its permissions, and run:

```sh
OZON_ENV_FILE=/absolute/private/ozon.env npm start
```

Never paste credentials into the portal, source code, commits, screenshots or issue reports. GitHub Pages runs only the synthetic demo; it cannot call the local API. No credentials are included in this repository.

## Version 0.2

- Add your own products, import sales windows and validated product JSON. Data stays in this browser and survives reloads.
- Store-wide allocation cap and persistent freeze switch for recommendations. These controls do not pause real Ozon campaigns.
- Unallocated advertising expenses trigger protection even without sales.
- Daily inventory forecast includes arrival quantity, missed demand, storage cost and additional purchase need.
- Export product data and decision records; 18 automated checks.

## Included

- Responsive Russian / Chinese management portal; no build required.
- Explainable strategy engine: limited test, seasonal hold, liquidation, stock protection, pause and settlement wait.
- Currency-aware unit economics with separate inbound / fulfilment / packaging / return provisions.
- Store defaults and SKU overrides, rolling-loss window and price-change limits.
- In-portal simulation notifications and decision audit history, stored in the current browser.
- Validated CSV scenario import/export; procurement batch schema for Excel.
- Local read-only Ozon Seller catalog adapter with bounded pages and request timeout.
- Chinese competition proposal, architecture, evaluation plan, demo script and delivery checklist.
- Deterministic safety tests and GitHub Actions CI / Pages workflow.

## Competition

Existing entry: **Ozon Ops Crew — 评论驱动的 Ozon Global 商家运营 Agent 系统**.
This version focuses the operating-agent scope on **profit-aware pricing, advertising and inventory**, preserving the existing entry name. Review-response automation is not implemented in this prototype.

[Q3 Brand Go-Global track](https://www.synnovator.com/hackathon/hfhahkjfdhakfhf) · [Existing entry](https://www.synnovator.com/arszlx/ozon-ops-agents)

Verified 2026-10-11: submission through **October 12**, preparation **October 13–16**, offline final **October 24–25**. Closing time/timezone is not stated. The top UI's October 16 results date conflicts with the detailed final schedule; use organizer confirmation for attendance.

## What the demo proves

The engine recomputes strategy decisions as storage, seasonal assumptions, stock or replenishment time change. It demonstrates why top-line growth can destroy profit and why increasing advertising before a stockout can be irrational. It does **not** prove demand causality, model accuracy or actual financial uplift.

## Before production

See [integration plan](docs/INTEGRATION.md). Implement settlement reconciliation, actual purchase batches, campaign-to-SKU allocation, real spend enforcement, persisted server-side notifications and authenticated user access. Validate Chinese-account Performance API permissions separately. Run shadow mode and a bounded pilot before enabling writes.

## Project structure

`web/` portal + pure decision engine · `server.mjs` localhost server · `ozon.mjs` read-only adapter · `tests/` safety scenarios · `docs/` competition packet · `templates/` procurement schemas.

## Rights and privacy

Original project source prepared for the owner. No third-party seller data, API keys, customer identifiers, account catalog exports or claimed proprietary Ozon assets are included. Ozon is referenced to describe integration compatibility; this is not an official Ozon product. No open-source license is granted until the owner selects one.

## Version 0.3 — economics-driven advertising loop
The Autopilot screen runs a deterministic agent workflow every 30 seconds while the browser tab is open: data validation → unit economics → stock constraints → budget allocation → risk checks → local simulated campaign execution → receipts. Repeated unchanged decisions are idempotent. Data older than one hour pauses the simulated campaigns. Reload does not auto-resume the loop. 22 automated tests pass.

This is an executable competition demonstration, not live Ozon advertising automation. Real activation requires separately verified Performance API access, complete actual costs, campaign membership checks, a persistent server worker and merchant-approved operating limits. No live uplift is claimed.

## Version 0.5 — marginal advertising profit
The Advertising Return screen allocates a capped daily budget using a diminishing-response scenario curve, incremental order share and unit contribution after a conservative storage allowance. It leaves inefficient budget unspent, excludes risk-blocked SKUs and requires at least 1.20 RUB incremental contribution per RUB spent. This is a discrete scenario optimizer, not a trained forecast or causal proof. Its output does not alter the automatic simulator or live campaigns. 27 tests pass.
