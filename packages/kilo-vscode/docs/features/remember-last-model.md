# Remember Last Model Choice

**Priority:** P2
**Issue:** [#6211](https://github.com/Kilo-Org/kilocode/issues/6211)

Model selection is in-memory only. No persistence across sessions/restarts.

## Remaining Work

- On model change, persist choice to `globalState.update('lastModel', modelId)`
- On new session, pre-select last-used model via `globalState.get('lastModel')`
- Fall back to default gracefully if stored model is no longer available
