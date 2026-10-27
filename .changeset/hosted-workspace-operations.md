---
"@kilocode/cli": minor
---

Add hosted workspace operations and a Cloud system feed to the local session-host API. List, create, and read hosted workspaces and start another session in a workspace through the local Kilo API, and follow Cloud session preparation and status events through a local system feed route. Hosted operations now exchange the stored user credential for a short-lived Cloud Agent control token before any Worker call, so the original credential is never sent to the Worker.
