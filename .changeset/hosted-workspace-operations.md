---
"@kilocode/cli": minor
---

Add hosted workspace operations and a Cloud system feed to the local session-host API. List, create, read, check the status of, and delete hosted workspaces, list their sessions, list available workspace profiles, and start another session in a workspace through the local Kilo API, and follow Cloud session preparation and status events through a local system feed route. Hosted operations now exchange the stored user credential for a short-lived Cloud Agent control token before any Worker call, so the original credential is never sent to the Worker. Hosted attachments stop working once their session or workspace is deleted.
