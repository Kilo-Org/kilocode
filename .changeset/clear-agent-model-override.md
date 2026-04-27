---
"kilo-code": patch
---

Fix clearing an agent's Model Override in Agent Behaviour settings. Previously, clearing the field and saving would repopulate the old value because the empty input was sent as `undefined` and dropped by `JSON.stringify`, so the backend never received a delete instruction. The field now reverts to the global default model as expected.
