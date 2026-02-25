# Browser Session Controls

**Priority:** P3
**Status:** 🔨 Partial

## What Exists

`BrowserTab` settings UI has enable/disable toggle, system Chrome, and headless mode options. `BrowserAutomationService` handles Playwright MCP server registration. Browser tool calls appear as generic MCP tool entries in chat.

## Remaining Work

- In-chat browser session controls (start/stop/navigate)
- Action replay and control buttons
- Screenshot viewing within chat messages
- Dedicated browser tool rendering (currently falls through to generic MCP tool display)
