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

Browser automation is built into the extension and requires no manual setup. Enable it from **Settings → Web Tools → Browser Automation** and Kilo handles the rest automatically.

{% callout type="note" title="Integrated Browser Is Separate" %}
The experimental **Integrated Browser** under **Settings → Experimental** is a different feature. It shows local application previews inside Agent Manager and does not replace Playwright browser automation. The two features have independent settings.
{% /callout %}

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

To test in another browser engine, emulate a phone or tablet, or use a fixed viewport, add Playwright MCP flags to the command:

```json
{
  "mcp": {
    "playwright": {
      "type": "local",
      "command": ["npx", "-y", "@playwright/mcp@latest", "--browser", "webkit", "--device", "iPhone 15"]
    }
  }
}
```

| Flag | Values |
|---|---|
| `--browser` | `chrome`, `msedge`, `firefox`, or `webkit` |
| `--device` | A Playwright device name, such as `iPhone 15`, `Pixel 7`, or `iPad Pro 11` |
| `--viewport-size` | `WIDTHxHEIGHT`, such as `1280x720` |

Install Firefox or WebKit once with `npx playwright install firefox` or `npx playwright install webkit`. Firefox does not support mobile device emulation. To compare engines in one session, add one server per engine under different names, such as `playwright-firefox` and `playwright-webkit`.

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
| `browser_snapshot` | Captures an accessibility snapshot of the page | Reading page structure and finding elements |
| `browser_take_screenshot` | Captures a screenshot of the page | Inspecting visual state |
| `browser_click` | Clicks an element on the page | Interacting with buttons, links, etc. |
| `browser_type` | Types text into an editable element | Filling forms, search boxes |
| `browser_fill_form` | Fills several form fields at once | Completing forms |
| `browser_press_key` | Presses a keyboard key | Scrolling with Page Down, submitting with Enter |
| `browser_hover` | Hovers over an element | Revealing tooltips or menus |
| `browser_select_option` | Selects an option from a dropdown | Choosing from select elements |
| `browser_drag` | Drags an element to a target | Drag-and-drop interactions |
| `browser_resize` | Resizes the browser window | Checking responsive layouts at other screen sizes |
| `browser_tabs` | Lists, opens, closes, or selects tabs | Working with several pages |
| `browser_console_messages` | Returns console messages | Finding JavaScript errors |

The exact set depends on the installed `@playwright/mcp` version. See the [Playwright MCP tool list](https://github.com/microsoft/playwright-mcp#tools) for all tools.

{% /tab %}
{% /tabs %}

## Browser Use Settings

{% tabs %}
{% tab label="VSCode" %}

Browser automation settings are available under **Settings → Web Tools → Browser Automation**:

- **Enable browser automation**: Lets the agent start a Playwright browser when a task needs one.
- **Allowed browsers**: The browsers the agent may use: Google Chrome, Chromium, Microsoft Edge, Firefox, and WebKit (the engine behind Safari). Chrome is enabled by default. Each browser shows whether it is installed.

You do not need all of them. Chrome and Edge can be enabled when they are installed on your machine. If one is not installed, its row is greyed out.

Chromium, Firefox, and WebKit are Playwright builds. A missing build shows its download size, and an installed build shows the disk space it takes. When you enable one that is missing, Kilo downloads it right away. A build is several files, so the row names the file it is downloading or unpacking and its position, such as `Downloading Firefox 156.0 (1/2): 40%`. If the download fails, the row shows the reason. Disable and enable the build to try again.

Kilo downloads the build that matches its Playwright version, so do not use `npx playwright install`, which can fetch a different build. The download needs Node.js with `npx` on your machine. On Linux, a build may also need system packages that the download does not include.

Disabling a build does not delete it. It stays in Playwright's browser cache on disk, and enabling it again does not download it again.

### Let Kilo choose the browser, device, and size

You do not configure a browser, device, viewport, or headless mode. No browser runs until a task needs one. Kilo then starts it with the `browser_profile` tool and picks the profile from the conversation:

- `Check the checkout page in Safari on an iPhone.` starts WebKit with iPhone emulation.
- `Does the menu also break in Firefox?` switches to Firefox on desktop.
- `Compare the dashboard at tablet and desktop widths.` resizes the window in the current browser.
- `Run the check in the background.` starts the browser headless.

The browser window is visible unless you ask for headless. Kilo can only use browsers you enabled under **Allowed browsers**, and it is told when one is not installed. It names the browser, device, and viewport when it reports results.

Things to know:

- **Switching restarts the browser.** Open pages, cookies, and logins are lost, so Kilo tests one browser after another, not side by side.
- **One browser per workspace folder.** All chat sessions in a folder share it. While one session is using the browser, another session cannot switch it and is told to wait.
- **Emulation is an approximation.** Playwright WebKit is not Safari itself, and device emulation is not a real phone. Firefox cannot emulate mobile devices.
- **Agent Manager worktree sessions** do not have the Playwright tools. They can use the Integrated Browser instead.

{% callout type="note" title="Integrated Browser screenshot sizes" %}
The experimental Integrated Browser's `browser_open` tool accepts an optional `width` and `height`, so the agent can check a page at phone, tablet, and desktop sizes. Only the returned screenshot uses that size, and the Integrated Browser always uses Chromium without mobile user agent or touch emulation.
{% /callout %}

{% /tab %}
{% tab label="CLI" %}

Browser automation is configured in your `kilo.jsonc` file. No additional settings are required — Playwright manages the browser lifecycle automatically.

{% /tab %}
{% /tabs %}
