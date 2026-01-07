import { ToolArgs } from "./types"

export function getBrowserActionDescription(args: ToolArgs): string | undefined {
	if (!args.supportsComputerUse) {
		return undefined
	}
	return `## browser_action
Description: Request to interact with a Puppeteer-controlled browser. Every action, except \`close\`, will be responded to with a screenshot of the browser's current state, along with any new console logs. You may only perform one browser action per message, and wait for the user's response including a screenshot and logs to determine the next action.

This tool is particularly useful for web development tasks as it allows you to launch a browser, navigate to pages, interact with elements through clicks and keyboard input, and capture the results through screenshots and console logs. Use it at key stages of web development tasks - such as after implementing new features, making substantial changes, when troubleshooting issues, or to verify the result of your work. Analyze the provided screenshots to ensure correct rendering or identify errors, and review console logs for runtime issues.

The user may ask generic non-development tasks (such as "what's the latest news" or "look up the weather"), in which case you might use this tool to complete the task if it makes sense to do so, rather than trying to create a website or using curl to answer the question. However, if an available MCP server tool or resource can be used instead, you should prefer to use it over browser_action.

**Browser Session Lifecycle:**
- Browser sessions **start** with \`launch\` and **end** with \`close\`
- The session remains active across multiple messages and tool uses
- You can use other tools while the browser session is active - it will stay open in the background

Parameters:
- action: (required) The action to perform. The available actions are:
    * launch: Launch a new Puppeteer-controlled browser instance at the specified URL. This **must always be the first action**.
        - Use with the \`url\` parameter to provide the URL.
        - Ensure the URL is valid and includes the appropriate protocol (e.g. http://localhost:3000/page, file:///path/to/file.html, etc.)
    * hover: Move the cursor to a specific x,y coordinate.
        - Use with the \`coordinate\` parameter to specify the location.
        - Always move to the center of an element (icon, button, link, etc.) based on coordinates derived from a screenshot.
    * click: Click at a specific x,y coordinate.
        - Use with the \`coordinate\` parameter to specify the location.
        - Always click in the center of an element (icon, button, link, etc.) based on coordinates derived from a screenshot.
    * type: Type a string of text on the keyboard. You might use this after clicking on a text field to input text.
        - Use with the \`text\` parameter to provide the string to type.
    * press: Press a single keyboard key or key combination (e.g., Enter, Tab, Escape, Cmd+K, Shift+Enter).
        - Use with the \`text\` parameter to provide the key name or combination.
        - For single keys: Enter, Tab, Escape, etc.
        - For key combinations: Cmd+K, Ctrl+C, Shift+Enter, Alt+F4, etc.
        - Supported modifiers: Cmd/Command/Meta, Ctrl/Control, Shift, Alt/Option
        - Example: <text>Cmd+K</text> or <text>Shift+Enter</text>
    * resize: Resize the viewport to a specific w,h size.
        - Use with the \`size\` parameter to specify the new size.
    * scroll_down: Scroll down the page by one page height.
    * scroll_up: Scroll up the page by one page height.
    * screenshot: Take a screenshot and save it to a file.
        - Use with the \`path\` parameter to specify the destination file path.
        - Supported formats: .png, .jpeg, .webp
        - Example: \`<action>screenshot</action>\` with \`<path>screenshots/result.png</path>\`
    * close: Close the Puppeteer-controlled browser instance. This **must always be the final browser action**.
        - Example: \`<action>close</action>\`
- url: (optional) Use this for providing the URL for the \`launch\` action.
    * Example: <url>https://example.com</url>
- coordinate: (optional) The X and Y coordinates for the \`click\` and \`hover\` actions.
    * **CRITICAL**: Screenshot dimensions are NOT the same as the browser viewport dimensions
    * Format: <coordinate>x,y@widthxheight</coordinate>
    * Measure x,y on the screenshot image you see in chat
    * The widthxheight MUST be the EXACT pixel size of that screenshot image (never the browser viewport)
    * Never use the browser viewport size for widthxheight - the viewport is only a reference and is often larger than the screenshot
    * Images are often downscaled before you see them, so the screenshot's dimensions will likely be smaller than the viewport
    * Example A: If the screenshot you see is 1094x1092 and you want to click (450,300) on that image, use: <coordinate>450,300@1094x1092</coordinate>
    * Example B: If the browser viewport is 1280x800 but the screenshot is 1000x625 and you want to click (500,300) on the screenshot, use: <coordinate>500,300@1000x625</coordinate>
- size: (optional) The width and height for the \`resize\` action.
    * Example: <size>1280,720</size>
- text: (optional) Use this for providing the text for the \`type\` action.
    * Example: <text>Hello, world!</text>
- path: (optional) File path for the \`screenshot\` action. Path is relative to the workspace.
    * Supported formats: .png, .jpeg, .webp
    * Example: <path>screenshots/my-screenshot.png</path>
Usage:
<browser_action>
<action>Action to perform (e.g., launch, click, type, press, scroll_down, scroll_up, close)</action>
<url>URL to launch the browser at (optional)</url>
<coordinate>x,y@widthxheight coordinates (optional)</coordinate>
<text>Text to type (optional)</text>
</browser_action>

Example: Requesting to launch a browser at https://example.com
<browser_action>
<action>launch</action>
<url>https://example.com</url>
</browser_action>

Example: Requesting to click on the element at coordinates 450,300 on a 1024x768 image
<browser_action>
<action>click</action>
<coordinate>450,300@1024x768</coordinate>
</browser_action>

Example: Taking a screenshot and saving it to a file
<browser_action>
<action>screenshot</action>
<path>screenshots/result.png</path>
</browser_action>`
}
