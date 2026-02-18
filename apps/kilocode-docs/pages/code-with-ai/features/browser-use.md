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

By default, Kilo Code uses a built-in browser that:

- Launches automatically when you ask Kilo to visit a website
- Captures screenshots of web pages
- Allows Kilo to interact with web elements
- Runs invisibly in the background

All of this happens directly within VS Code, with no setup required.

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

The browser_action tool controls a browser instance that returns screenshots and console logs after each action, allowing you to see the results of interactions.

Key characteristics:

- Each browser session must start with `launch` and end with `close`
- Only one browser action can be used per message
- While the browser is active, no other tools can be used
- You must wait for the response (screenshot and logs) before performing the next action

### Available Browser Actions

| Action        | Description                    | When to Use                           |
| ------------- | ------------------------------ | ------------------------------------- |
| `launch`      | Opens a browser at a URL       | Starting a new browser session        |
| `click`       | Clicks at specific coordinates | Interacting with buttons, links, etc. |
| `type`        | Types text into active element | Filling forms, search boxes           |
| `scroll_down` | Scrolls down by one page       | Viewing content below the fold        |
| `scroll_up`   | Scrolls up by one page         | Returning to previous content         |
| `close`       | Closes the browser             | Ending a browser session              |

## Browser Use Settings

{% callout type="info" title="Default Browser Settings" %}

- **Enable browser tool**: Enabled
- **Viewport size**: Small Desktop (900x600)
- **Screenshot quality**: 75%
- **Use remote browser connection**: Disabled

{% /callout %}

### Accessing Settings

To change Browser / Computer Use settings in Kilo:

1. Click the gear icon {% codicon name="gear" /%} in Kilo Code
2. Open `Browser / Computer Use`

### Enable/Disable Browser Use

**Purpose**: Master toggle that enables Kilo to interact with websites using a Puppeteer-controlled browser.

To change this setting:

1. Check or uncheck the "Enable browser tool" checkbox within your Browser / Computer Use settings

### Viewport Size

**Purpose**: Determines the resolution of the browser session Kilo Code uses.

**Tradeoff**: Higher values provide a larger viewport but increase token usage.

To change this setting:

1. Click the dropdown menu under "Viewport size" within your Browser / Computer Use settings
2. Select one of the available options:
    - Large Desktop (1280x800)
    - Small Desktop (900x600) - Default
    - Tablet (768x1024)
    - Mobile (360x640)
3. Select your desired resolution.

### Screenshot Quality

**Purpose**: Controls the WebP compression quality of browser screenshots.

**Tradeoff**: Higher values provide clearer screenshots but increase token usage.

To change this setting:

1. Adjust the slider under "Screenshot quality" within your Browser / Computer Use settings
2. Set a value between 1-100% (default is 75%)
3. Higher values provide clearer screenshots but increase token usage:

    - 40-50%: Good for basic text-based websites
    - 60-70%: Balanced for most general browsing
    - 80%+: Use when fine visual details are critical

### Remote Browser Connection

**Purpose**: Connect Kilo to an existing Chrome browser instead of using the built-in browser.

**Benefits**:

- Works in containerized environments and remote development workflows
- Maintains authenticated sessions between browser uses
- Eliminates repetitive login steps
- Allows use of custom browser profiles with specific extensions

**Requirements**: Chrome must be running with remote debugging enabled.

To enable this feature:

1. Check the "Use remote browser connection" box in Browser / Computer Use settings
2. Click "Test Connection" to verify

#### Common Use Cases

- **DevContainers**: Connect from containerized VS Code to host Chrome browser
- **Remote Development**: Use local Chrome with remote VS Code server
- **Custom Chrome Profiles**: Use profiles with specific extensions and settings

#### Connecting to a Visible Chrome Window

Connect to a visible Chrome window to observe Kilo's interactions in real-time:

**macOS**

```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-debug --no-first-run
```

**Windows**

```bash
"C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir=C:\chrome-debug --no-first-run
```

**Linux**

```bash
google-chrome --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-debug --no-first-run
```
