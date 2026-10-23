# Contest edition · 2026-10-23

Entry: **Ozon Ops Crew — AIGC 商品表达与单品利润决策**. Track: **AI产品资料子赛道**.

This directory is the prepared contest edition, based on local commit `72bf6b0`. It contains the two local improvements after the last observed public branch commit `1f0c61d` and the documentation reconciliation. A local edition or ZIP is not proof of GitHub publication or an updated organizer submission.

## Judge path

1. Read [Chinese proposal](SUBMISSION.zh.md): problem, deliverable and evidence by criterion.
2. Run the public synthetic demonstration (no account or API): from the repository root, `npm run demo:build`, then `npm run demo:serve`; open http://127.0.0.1:4174/ . Node >=22.13 is sufficient; no npm installation is required for this static demo. Stop with Ctrl+C.
3. Follow the [six-minute walkthrough](DEMO-SCRIPT.zh.md), or [three-minute pitch](PITCH-3MIN.zh.md), and [current Q&A](FINAL-QA.zh.md).
4. For the complete local workspace: `npm ci`, `npm test`, `npm start`, then http://127.0.0.1:4173/ . Real connections and the installed, authenticated Codex CLI require separate local setup; no account or credential is bundled. See [LIVE-API](LIVE-API.md).
5. Read [architecture](ARCHITECTURE.md), [Specs](SPECS.md), [evidence](EVALUATION.md), [safety boundaries](COMPLIANCE.md) and [verification record](RELEASE-VERIFICATION.json).

## One story, three evidence levels

- **Demonstrated:** Chinese synthetic public scenario, genuinely generated sample images, version confirmation and contribution calculation. It replays prepared results; it does not generate images or publish to a store.
- **Implemented:** bounded text generation, external image upload and review, source/version hashes, persistent local workflow; Ozon reads and gated price/CPO adapters; preliminary WB adapters. Implementation and synthetic tests do not establish real-account write support or business value.
- **Still needed:** a consenting target seller, real product facts and image rights, a paired time/quality study, actual publication verification if publication is claimed. Profit uplift is unmeasured.

Primary contest proof: **review → verified facts → Russian content and image brief → externally generated image → human review → exportable result**. Ozon economics is a follow-up validation module, not a prerequisite for proving content-production time saving.

## Historical material

[HISTORY](HISTORY.md), old simulator/scaling/value-model notes, screenshots and `demo.mp4` preserve development history. They are not the current walkthrough or measured outcomes. No current video is supplied: use the tested interactive demo and current scripts. [Organizer README draft](ORGANIZER-README.zh.md) is prepared text; saved historical organizer text is retained in `docs/archive/`.

## Publication status

The intended immutable edition is Git tag `contest-2026-10-23`, with the integrated source in `main`. Publication is verified separately by the GitHub release and the delivery receipt accompanying the ZIP. Organizer replacement is **not confirmed**; do not treat code publication as an organizer save. Existing remote entry points are in [SUBMISSION-LINKS](SUBMISSION-LINKS.md). Final schedule on the official page was checked on 2026-10-23: October 24–25; the page also marks its online stage Finished. Individual presentation time and permission to amend submitted materials are not established.
