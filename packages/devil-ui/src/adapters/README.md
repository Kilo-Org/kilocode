# Adapters

The DOM adapter (createDomAdapter) is re-exported from the barrel (./index.ts).

The terminal adapter (createTerminalAdapter) is NOT re-exported from the barrel.
Import it directly: import { createTerminalAdapter } from "@devilcode/kilo-ui/adapters/terminal"

Reason: createTerminalAdapter uses dynamic import of @opentui/* at runtime.
Re-exporting it from the barrel would cause @opentui/* to be pulled into DOM-only
bundles (VS Code webview, web app) that never call the factory.
