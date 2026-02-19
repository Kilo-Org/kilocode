---
"cmbt-agent": major
---

BREAKING CHANGE: Rename extension from kilo-code to cmbt-agent

The VS Code extension has been renamed from "kilo-code" to "cmbt-agent". This is a breaking change that affects:

- Extension identifier: `kilo-code` → `cmbt-agent`
- All command IDs: `kilo-code.*` → `cmbt-agent.*`
- Configuration keys: `kilo-code.*` → `cmbt-agent.*`
- Context keys: `kilocode.*` → `cmbtagent.*`
- View container IDs: `kilo-code-ActivityBar` → `cmbt-agent-ActivityBar`

Users will need to:

- Uninstall the old "kilo-code" extension
- Install the new "cmbt-agent" extension
- Update any custom keybindings that reference `kilo-code.*` commands
- Update any workspace settings that use `kilo-code.*` configuration keys
