# Integration plan

## Available now
Local adapter: `POST https://api-seller.ozon.ru/v3/product/list`, read-only JSON retrieval, pages of 20, cursor input and 15-second timeout. Verified using provided credentials; secrets and returned catalog data remain outside the repository. Official documentation entry: https://docs.ozon.ru/api/seller/ . Documentation fetch encountered a redirect loop during preparation; other methods are intentionally not guessed or enabled.

## Needed next
Seller API: actual prices, inventory, FBO/FBS orders, financial operations and settlement reports. Confirm current schema and permissions for this Chinese account before implementation. Performance API uses separate authorization: do not reuse the Seller key or assume advertising rights. Verify campaign membership and campaign-level vs SKU-level controls before pausing.

The product is for a Chinese seller, not a Russian importer. No procurement/import workflow is required. Seller-provided product costs and actual marketplace fees are reconciled separately; currencies stay explicit and are not converted automatically. See LIVE-API.md for the current implemented scope.

## Secret handling
Use an external permission-restricted env file. Do not add it to source control or public deployment. The API server binds only to localhost and rejects nonlocal Host headers. The prototype lacks production identity management and must not be exposed publicly with real credentials. Rotate a credential if it is disclosed outside the intended private channel.

## Production gates
Reconciliation complete; explicit merchant budgets; aggregate spend cap; zero-sales spend trip; stale-data halt; duplicate-call prevention; verified pause response; persistent audit; role-based access; notification delivery; manual resume; regional data handling assessment.

## Verified Performance read access
On 2026-10-11 token authorization and campaign listing were verified against the live account. `performance.mjs` uses `POST /api/client/token` and read-only `GET /api/client/campaign` at api-performance.ozon.ru. Credentials are read from an external OZON_PERFORMANCE_ENV_FILE, tokens remain server-only and are cached until shortly before expiry. No campaign mutation method is implemented. Public Pages serves no account data. Actual costs, SKU membership, permitted budgets and account-specific write semantics still need verification before enabling execution.
