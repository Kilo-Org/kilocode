---
"kilo-code": patch
"@kilocode/cli": patch
---

Fix model precedence so mode-configured models win over remembered picks in new sessions. Manual model picks now apply per agent within each session or draft, reopened sessions immediately show the agent and model they last ran with, and the plan follow-up "Start new session" keeps the planning session in Plan mode. The model picker recovers on its own after a Kilo catalog failure and says when Kilo models are unavailable.
