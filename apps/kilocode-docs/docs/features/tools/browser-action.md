# browser_action

The `browser_action` tool enables web automation and interaction via a Puppeteer-controlled browser. It allows Kilo Code to launch browsers, navigate to websites, click elements, type text, and scroll pages with visual feedback through screenshots.

## Parameters

The tool accepts these parameters:

- `action` (required): The action to perform:
  * `launch`: Start a new browser session at a URL
  * `click`: Click at specific x,y coordinates
  * `type`: Type text via the keyboard
  * `scroll_down`: Scroll down one page height
  * `scroll_up`: Scroll up one page height
  * `close`: End the browser session
- `url` (optional): The URL to navigate to when using the `launch` action
- `coordinate` (optional): The x,y coordinates for the `click` action (e.g., "450,300")
- `text` (optional): The text to type when using the `type` action

## What It Does

This tool creates an automated browser session that Kilo Code can control to navigate websites, interact with elements, and perform tasks that require browser automation. Each action provides a screenshot of the current state, enabling visual verification of the process.

## When is it used?

- When Kilo Code needs to interact with web applications or websites
- When testing user interfaces or web functionality
- When capturing screenshots of web pages
- When demonstrating web workflows visually

## Key Features

- Provides visual feedback with screenshots after each action and captures console logs
- Supports complete workflows from launching to page interaction to closing
- Enables precise interactions via coordinates, keyboard input, and scrolling
- Maintains consistent browser sessions with intelligent page loading detection
- Operates in two modes: local (isolated Puppeteer instance) or remote (connects to existing Chrome)
- Handles errors gracefully with automatic session cleanup and detailed messages
- Optimizes visual output with support for various formats and quality settings
- Tracks interaction state with position indicators and action history

## Browser Modes

The tool operates in two distinct modes:

### Local Browser Mode (Default)
- Downloads and manages a local Chromium instance through Puppeteer
- Creates a fresh browser environment with each launch
- No access to existing user profiles, cookies, or extensions
- Consistent, predictable behavior in a sandboxed environment
- Completely closes the browser when the session ends

### Remote Browser Mode
- Connects to an existing Chrome/Chromium instance running with remote debugging enabled
- Can access existing browser state, cookies, and potentially extensions
- Faster startup as it reuses an existing browser process
- Supports connecting to browsers in Docker containers or on remote machines
- Only disconnects (doesn't close) from the browser when session ends
- Requires Chrome to be running with remote debugging port open (typically port 9222)

## Limitations

- While the browser is active, only `browser_action` tool can be used
- Browser coordinates are viewport-relative, not page-relative
- Click actions must target visible elements within the viewport
- Browser sessions must be explicitly closed before using other tools
- Browser window has configurable dimensions (default 900x600)
- Cannot directly interact with browser DevTools
- Browser sessions are temporary and not persistent across Kilo Code restarts
- Works only with Chrome/Chromium browsers, not Firefox or Safari
- Local mode has no access to existing cookies; remote mode requires Chrome with debugging enabled

## How It Works

When the `browser_action` tool is invoked, it follows this process:

1. **Action Validation and Browser Management**:
   - Validates the required parameters for the requested action
   - For `launch`: Initializes a browser session (either local Puppeteer instance or remote Chrome)
   - For interaction actions: Uses the existing browser session
   - For `close`: Terminates or disconnects from the browser appropriately

2. **Page Interaction and Stability**:
   - Ensures pages are fully loaded using DOM stability detection via `waitTillHTMLStable` algorithm
   - Executes requested actions (navigation, clicking, typing, scrolling) with proper timing
   - Monitors network activity after clicks and waits for navigation when necessary

3. **Visual Feedback**:
   - Captures optimized screenshots using WebP format (with PNG fallback)
   - Records browser console logs for debugging purposes
   - Tracks mouse position and maintains paginated history of actions

4. **Session Management**:
   - Maintains browser state across multiple actions
   - Handles errors and automatically cleans up resources
   - Enforces proper workflow sequence (launch → interactions → close)

## Workflow Sequence

Browser interactions must follow this specific sequence:

1. **Session Initialization**: All browser workflows must start with a `launch` action
2. **Interaction Phase**: Multiple `click`, `type`, and scroll actions can be performed
3. **Session Termination**: All browser workflows must end with a `close` action
4. **Tool Switching**: After closing the browser, other tools can be used

## Examples When Used

- When creating a web form submission process, Kilo Code launches a browser, navigates to the form, fills out fields with the `type` action, and clicks submit.
- When testing a responsive website, Kilo Code navigates to the site and uses scroll actions to examine different sections.
- When capturing screenshots of a web application, Kilo Code navigates through different pages and takes screenshots at each step.
- When demonstrating an e-commerce checkout flow, Kilo Code simulates the entire process from product selection to payment confirmation.

## Usage Examples

Launching a browser and navigating to a website:
```
<browser_action>
<action>launch</action>
<url>https://example.com</url>
</browser_action>
```

Clicking at specific coordinates (e.g., a button):
```
<browser_action>
<action>click</action>
<coordinate>450,300</coordinate>
</browser_action>
```

Typing text into a focused input field:
```
<browser_action>
<action>type</action>
<text>Hello, World!</text>
</browser_action>
```

Scrolling down to see more content:
```
<browser_action>
<action>scroll_down</action>
</browser_action>
```

Closing the browser session:
```
<browser_action>
<action>close</action>
</browser_action>
```
