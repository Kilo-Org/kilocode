---
"@kilocode/cli": minor
---

Remote CLI session lifecycle: create_session accepts optional agent, model, and orgId (org claim rides session metadata); CLI adopts backend renames via system session.renamed and POSTs local title changes (generation-aware) to the ingest title route so auto-titles and explicit renames stay in sync.
