import type OpenAI from "openai"

export default function browser_action(): OpenAI.Chat.ChatCompletionTool {
	return {
		type: "function",
		function: {
			name: "browser_action",
			description: `Description: Request to interact with a Puppeteer-controlled browser. Every action, except \`close\`, will be responded to with a screenshot of the browser's current state, along with any new console logs. You may only perform one browser action per message, and wait for the user's response including a screenshot and logs to determine the next action.
- The sequence of actions **must always start with** launching the browser at a URL, and **must always end with** closing the browser. If you need to visit a new URL that is not possible to navigate to from the current webpage, you must first close the browser, then launch again at the new URL.
- While the browser is active, only the \`browser_action\` tool can be used. No other tools should be called during this time. You may proceed to use other tools only after closing the browser. For example if you run into an error and need to fix a file, you must close the browser, then use other tools to make the necessary changes, then re-launch the browser to verify the result.

- Before clicking on any elements such as icons, links, or buttons, you must consult the provided screenshot of the page to determine the coordinates of the element. The click should be targeted at the **center of the element**, not on its edges.`,
			strict: true,
			parameters: {
				type: "object",
				properties: {
					action: {
						type: "string",
						description: `action: (required) The action to perform. The available actions are:
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
    * resize: Resize the viewport to a specific w,h size.
        - Use with the \`size\` parameter to specify the new size.
    * scroll_down: Scroll down the page by one page height.
    * scroll_up: Scroll up the page by one page height.
    * close: Close the Puppeteer-controlled browser instance. This **must always be the final browser action**.`,
						enum: ["launch", "hover", "click", "type", "resize", "scroll_down", "scroll_up", "close"],
					},
					url: {
						type: ["string", "null"],
						description: "Use this for providing the URL for the launch action.",
					},
					coordinate: {
						type: ["object", "null"],
						description: `The X and Y coordinates for the \`click\` and \`hover\` actions.`,
						properties: {
							x: {
								type: "number",
								description: "Horizontal pixel position within the current viewport",
							},
							y: {
								type: "number",
								description: "Vertical pixel position within the current viewport",
							},
						},
						required: ["x", "y"],
						additionalProperties: false,
					},
					size: {
						type: ["object", "null"],
						description: "The width and height for the \`resize\` action.",
						properties: {
							width: {
								type: "number",
								description: "Viewport width in pixels",
							},
							height: {
								type: "number",
								description: "Viewport height in pixels",
							},
						},
						required: ["width", "height"],
						additionalProperties: false,
					},
					text: {
						type: ["string", "null"],
						description: "Use this for providing the text for the \`type\` action.",
					},
				},
				required: ["action", "url", "coordinate", "size", "text"],
				additionalProperties: false,
			},
		},
	}
}
