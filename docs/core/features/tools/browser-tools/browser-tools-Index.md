# Tools - Browser Tools

**Quick Navigation for AI Agents**

---

## Overview

Browser automation tools. Enable AI to interact with web pages, take screenshots, and perform web actions.

**Source Location**: `src/core/tools/`

---

## Tools

| Tool | Purpose | File | Size |
|------|---------|------|------|
| BrowserActionTool | Browser automation | `BrowserActionTool.ts` | 10KB |

---

## BrowserActionTool

**Purpose**: Automate browser interactions

**Parameters**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| action | string | Yes | Action type |
| url | string | No | URL to navigate |
| selector | string | No | CSS selector |
| text | string | No | Text to input |

**Actions**:
| Action | Description |
|--------|-------------|
| `launch` | Launch browser |
| `navigate` | Go to URL |
| `click` | Click element |
| `type` | Type text |
| `screenshot` | Take screenshot |
| `close` | Close browser |

**Behavior**:
1. Launches headless browser (if needed)
2. Performs requested action
3. Returns screenshot/result

---

## Related

- [Browser Service](../../../../services/features/browser/) - Browser session management

---

[← Back to Tools](../tools-Index.md)
