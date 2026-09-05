---
"@kilocode/cli": patch
---

Guard against plugins that resolve to `undefined` when notifying hooks. A no-op plugin boot stub previously pushed `undefined` into the hooks array, then crashed the "notify plugins of current config" loop with `Cannot read properties of undefined (reading 'config')`, which blocked server initialization for users with many plugins.