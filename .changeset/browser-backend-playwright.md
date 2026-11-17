---
"@kilocode/cli": minor
"kilo-code": minor
---

Add browser tools backed by the bundled Playwright MCP. Every agent gets the `browser_*` tool family, configured by `browser.backend` (playwright, extension, or off), `browser.observation` (full, diff, or none), `browser.allowSensitive`, and `experimental.browser_extension`. The Playwright browser and a Kilo-owned profile ship with the CLI, so no `npx` launch is needed. Web Tools has a browser backend picker, and the old Browser Automation toggle migrates to `browser.backend`.
