# Current architecture · contest edition 2026-10-23

Primary flow: buyer objection → verified seller facts → Russian content / Chinese image brief → external image generation → human review → frozen version. Optional follow-up: SKU economics and a separately approved marketplace experiment.

```mermaid
flowchart LR
 A[Review + product facts + source image] --> B[Validate source and rights]
 B --> C[Bounded Codex text transformation]
 C --> D[Validate structured output]
 D --> E[External image tool: manual]
 E --> F[Upload and compare]
 F --> G[Human fact / visual / Russian / rights review]
 G --> H[Version hash and audit]
 H --> I[Optional SKU experiment]
 I --> J[Costs and comparable periods]
```

| Responsibility | Code | Inputs / result / authority |
|---|---|---|
| Source checks | `core/review-creatives.mjs` | Product, review and store match; rights/facts confirmed; missing facts remain missing |
| Text generation | `adapters/review-creative.mjs`, `adapters/codex.mjs` | Structured Russian text and Chinese edit prompt; external Codex CLI; source content treated as untrusted data; no marketplace write |
| Queue / state | `core/review-creatives.mjs`, `core/repository.mjs` | Persisted queued/generating/review states, hashes, audit; one local process, not a distributed job service |
| Image and review | `adapters/media.mjs`, `core/review-creatives.mjs` | External image upload, declared provider, revision history; all four checks required; image edits invalidate approval |
| Link to experiment | `creativeTrialSnapshot()` | Same store/SKU and exact approved image/text snapshot; publication explicitly unverified |
| Economics | `core/sku-costs.mjs`, `core/finance-reconciliation.mjs` | Deterministic calculations; explicit missing data, periods and versions |
| Marketplace action | `core/workspace.mjs`, `core/cpo-control.mjs`, adapters | Prepare → exact approval → explicit execution → readback; unknown response cannot be blindly replayed |

The complete workspace is served by `server.mjs` on loopback. State and uploaded assets persist locally on the server; secrets stay outside public assets. The bounded text request sends supplied product/review facts to the configured provider: local storage does not mean no external processing. Images require an external manual generation step. Public GitHub Pages is a separate synthetic replay with an explicit asset allowlist (`scripts/build-public-demo.mjs`).

## Demonstrated boundary

Synthetic tests verify source/version checks and representative workflows. Real Ozon read evidence is historical and scoped as described in [EVALUATION](EVALUATION.md). Complete real image publication, marketplace write results, paired seller time saving and profit uplift are not proven.

The legacy browser simulator and its six deterministic stages remain historical code; its 30-second loop is not the current AIGC orchestration or a production autonomous trading agent. [SPECS](SPECS.md) details the optional economics pipeline. Production authentication, tenant isolation, distributed workers and guaranteed platform spend stops are unfinished. No promise of automatic profit maximization is made.
