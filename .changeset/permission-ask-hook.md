---
"@kilocode/cli": patch
---

Run the documented `permission.ask` plugin hook. It was declared in the plugin API and described in the docs, but never invoked, so plugins registering it were silently ignored. A hook can now allow, ask or deny, and explain a denial — but it cannot cancel a prompt Kilo requires a human to answer.
