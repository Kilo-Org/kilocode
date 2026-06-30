---
title: "Browser Use"
description: "Using Kilo Code to interact with web browsers"
---

# Browser Use

Kilo Code provides browser automation capabilities that let you interact with websites directly from your coding workflow. This feature supports testing web applications, automating browser tasks, and capturing screenshots without leaving your editor.

{% callout type="info" title="Model Support Required" %}
Browser Use requires an advanced agentic model. It is typically most reliable with recent high-capability models (for example Claude Sonnet 4 class models).
{% /callout %}

## How Browser Use Works

{% tabs %}
{% tab label="VSCode" %}

Browser automation is built into the extension and requires no manual setup. Enable it from **Settings → Browser** and Kilo handles the rest automatically.

{% /tab %}
{% tab label="CLI" %}

Kilo Code uses [Playwright](https://playwright.dev/) for browser automation. Add it to your `kilo.jsonc` configuration:

```json
{
  "mcp": {
    "playwright": {
      "type": "local",
      "command": ["npx", "-y", "@playwright/mcp@latest"]
    }
  }
}
```

Playwright downloads Chromium automatically on first use.

{% /tab %}
{% /tabs %}

## Using Browser Use

A typical browser interaction follows this pattern:

1. Ask Kilo to visit a website
2. Kilo launches the browser and shows you a screenshot
3. Request additional actions (clicking, typing, scrolling)
4. Kilo closes the browser when finished

For example:

- `Open the browser and view our site.`
- `Can you check if my website at https://kilocode.ai is displaying correctly?`
- `Browse http://localhost:3000, scroll down to the bottom of the page and check if the footer information is displaying correctly.`

## How Browser Actions Work

{% tabs %}
{% tab label="VSCode" %}

Kilo launches a browser automatically when asked and returns screenshots after each action so you can see what's happening. It can navigate to URLs, click elements, fill in forms, scroll, hover, select from dropdowns, and drag and drop — all driven by natural language instructions in chat.

{% /tab %}
{% tab label="CLI" %}

The Playwright MCP server provides a set of browser tools for interacting with web pages. These tools return screenshots and accessibility snapshots after each action.

Key characteristics:

- The browser launches automatically when a browser tool is invoked
- Multiple browser tools can be used in sequence
- Screenshots are captured after each action for visual feedback

### Available Browser Tools

| Tool | Description | When to Use |
|---|---|---|
| `browser_navigate` | Navigates to a URL | Opening a web page |
| `browser_click` | Clicks an element on the page | Interacting with buttons, links, etc. |
| `browser_type` | Types text into an input element | Filling forms, search boxes |
| `browser_screenshot` | Captures a screenshot of the page | Inspecting visual state |
| `browser_scroll` | Scrolls the page or a specific area | Viewing content above or below |
| `browser_hover` | Hovers over an element | Revealing tooltips or menus |
| `browser_select` | Selects an option from a dropdown | Choosing from select elements |
| `browser_drag` | Drags an element to a target | Drag-and-drop interactions |

{% /tab %}
{% /tabs %}

## Browser Use Settings

{% tabs %}
{% tab label="VSCode" %}

Browser automation settings are available under **Settings → Browser**:

- **Enable browser automation**: Toggle to enable or disable browser automation
- **Headless mode**: Run the browser without a visible window (default: disabled)
- **Use system Chrome**: Enabled by default — uses your installed Chrome. Disable to have Playwright download and use Chromium instead.

{% /tab %}
{% tab label="CLI" %}

Browser automation is configured in your `kilo.jsonc` file. No additional settings are required — Playwright manages the browser lifecycle automatically.

{% /tab %}
{% /tabs %}
