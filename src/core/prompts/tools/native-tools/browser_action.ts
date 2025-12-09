import type OpenAI from "openai"

const BROWSER_ACTION_DESCRIPTION = `Request to interact with a Puppeteer-controlled browser. Every action, except close, will be responded to with a screenshot of the browser's current state, along with any new console logs. You may only perform one browser action per message, and wait for the user's response including a screenshot and logs to determine the next action.

Browser Session Lifecycle:
- Browser sessions start with launch and end with close
- The session remains active across multiple messages and tool uses
- You can use other tools while the browser session is active - it will stay open in the background`

const ACTION_PARAMETER_DESCRIPTION = `Browser action to perform`

const URL_PARAMETER_DESCRIPTION = `URL to open when performing the launch action; must include protocol`

const COORDINATE_PARAMETER_DESCRIPTION = `Screen coordinate for hover or click actions in format 'x,y@WIDTHxHEIGHT' where x,y is the target position on the screenshot image and WIDTHxHEIGHT is the exact pixel dimensions of the screenshot image (not the browser viewport). Example: '450,203@900x600' means click at (450,203) on a 900x600 screenshot. The coordinates will be automatically scaled to match the actual viewport dimensions.`

const SIZE_PARAMETER_DESCRIPTION = `Viewport dimensions for the resize action in format 'WIDTHxHEIGHT' or 'WIDTH,HEIGHT'. Example: '1280x800' or '1280,800'`

const TEXT_PARAMETER_DESCRIPTION = `Text to type when performing the type action, or key name to press when performing the press action (e.g., 'Enter', 'Tab', 'Escape')`

export default {
	type: "function",
	function: {
		name: "browser_action",
		description: BROWSER_ACTION_DESCRIPTION,
		strict: false,
		parameters: {
			type: "object",
			properties: {
				action: {
					type: "string",
					description: ACTION_PARAMETER_DESCRIPTION,
					enum: ["launch", "click", "hover", "type", "press", "scroll_down", "scroll_up", "resize", "close"],
				},
				url: {
					type: ["string", "null"],
					description: URL_PARAMETER_DESCRIPTION,
				},
				coordinate: {
					type: ["string", "null"],
					description: COORDINATE_PARAMETER_DESCRIPTION,
				},
				size: {
					type: ["string", "null"],
					description: SIZE_PARAMETER_DESCRIPTION,
				},
				text: {
					type: ["string", "null"],
					description: TEXT_PARAMETER_DESCRIPTION,
				},
			},
			required: ["action"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool
