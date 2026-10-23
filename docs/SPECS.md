# Ops Crew — core Ozon scenario specification

Contest priority (2026-10-23): a Chinese-speaking seller turns verified product facts and a buyer objection into reviewed Russian content and an external image-generation brief. See [ARCHITECTURE](ARCHITECTURE.md) and [CONTENT-PILOT](CONTENT-PILOT.md). The table below specifies the optional Ozon economics/action pipeline, not a prerequisite for the content case. Content-production time saving and commercial contribution are measured separately. Preliminary WB functions remain available.

## User path and contracts

| Step | User-visible outcome | Implementation / evidence | Completion condition |
|---|---|---|---|
| Read | Store/SKU activity, coverage, missing costs | `live-service.mjs`, `core/finance-service.mjs`, `core/ad-reading-service.mjs` | Account, SKU, period and source status match; missing values stay unknown |
| Diagnose | Reason and next action on the Chinese home | `web/store-home.mjs`, `web/decisions.mjs`, `web/experiment-progress.mjs` | Reason points to actual data or a named missing input |
| Inspect | Current price and promotion conflicts before cost entry | `Workspace.inspectPriceConditions`; `POST /api/workspace/stores/:id/price-conditions` | Read-only evidence and blockers persisted; no plan, approval or write created |
| Plan | One parameter, baseline/variant, hypothesis, controls, dates, limits | `core/profit-trials.mjs`, `core/sku-costs.mjs`, `Workspace.planTrial` | Same-store SKU, validated dates; price scenario uses latest seller-reviewed cost assumptions |
| Prepare | Exact proposed change and fresh platform context | `core/workspace.mjs` price methods; `core/cpo-control.mjs` | Account supports this action; fresh price/CPO state; parameter and cost constraints checked |
| Confirm | Chinese diff and immutable payload hash | Workspace operation gate | Seller confirms that exact version; changing evidence invalidates approval |
| Execute | API receipt, including uncertain outcomes | Ozon price/CPO adapters | Separate explicit execution; no success claim from an unverified or ambiguous response |
| Verify | Platform readback tied to the operation | `reconcilePrice`, CPO reconciliation | Observed state matches target; matching state alone is not proof of causal origin |
| Measure | Before/after daily contribution with blockers | `core/finance-reconciliation.mjs` | Correct periods, current report/cost versions, actual execution and comparability checked |
| Next step | Repeat candidate, no improvement or insufficient evidence | `core/repeat-trials.mjs` | Fresh dates and matching hypothesis; no inherited execution approval |

```mermaid
flowchart LR
    A[Real Ozon sources] --> B[Validate scope and coverage]
    B --> C[Code calculates SKU economics]
    C --> D[Hypothesis and bounded plan]
    D --> E[Fresh API context]
    E --> F[Seller confirms exact diff]
    F --> G[Explicit API execution]
    G --> H[Readback]
    H --> I[Completed periods and reviewed costs]
    I --> J[Daily contribution comparison]
    J --> K[Next action or missing evidence]
```

## State and safety invariants

- Local data and secrets stay server-side. GitHub Pages serves only an explicit public asset list and synthetic examples.
- Price and CPO writes are separate from planning. Gates do not authorize another account, SKU, version or later repeated experiment.
- Unknown API outcome is not a failure that can be blindly retried. A cancelled plan does not roll back a platform setting.
- Budgets and loss thresholds are recorded and can be checked; automatic platform stop is not guaranteed or claimed.
- Results include organic sales, relevant costs and advertising. Net platform accrual and gross revenue must not be mixed in a way that subtracts fees twice.
- Report/cost changes invalidate current conclusions; previous calculations remain inspectable history.
- AI content output is a draft. Source material, prompt/result hashes, version and human review are retained. Generated images cannot repair physical defects.
- One localhost process is the current deployment boundary. Production authentication, tenant isolation and durable distributed workers are not complete.

## What is implemented versus demonstrated

Adapters, gates, deterministic calculations and synthetic end-to-end tests are implemented. Real read-only data exists locally. The real write → readback → completed experiment → measured effect sequence is **not yet demonstrated**. The 10-SKU manual/assisted pilot is prepared but unmeasured. See [EVALUATION.md](EVALUATION.md) and [PILOT-PROTOCOL.md](PILOT-PROTOCOL.md).

## Reproduce the current workspace

```sh
git clone --branch contest-2026-10-23 https://github.com/arszs/ozon-ops-crew.git
cd ozon-ops-crew
npm ci
npm test
npm start
```

Requires Node >=22.13. Open `http://127.0.0.1:4173/`. Authorized real connections use local server configuration described in [LIVE-API.md](LIVE-API.md); do not put keys in browser forms, Git, or public artifacts. The public demo at <https://arszs.github.io/ozon-ops-crew/> is synthetic and can be reviewed without credentials.
