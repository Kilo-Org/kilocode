import type { BrowserActionParams, Coordinate, Size } from "@roo-code/types"
import { Task } from "../task/Task"
import { BaseTool, ToolCallbacks } from "./BaseTool"
import type { ToolUse } from "../../shared/tools"
import {
	BrowserAction,
	BrowserActionResult,
	browserActions,
	ClineSayBrowserAction,
} from "../../shared/ExtensionMessage"
import { formatResponse } from "../prompts/responses"

export class BrowserActionTool extends BaseTool<"browser_action"> {
	readonly name = "browser_action" as const

	parseLegacy(params: Partial<Record<string, string>>): BrowserActionParams {
		const action = params.action as BrowserAction | undefined

		// Parse coordinate if present - XML protocol sends "x,y" format
		let coordinate: Coordinate | undefined
		if (params.coordinate) {
			// Try parsing as "x,y" string first (XML protocol)
			const parts = params.coordinate.split(",")
			if (parts.length === 2) {
				const x = parseInt(parts[0], 10)
				const y = parseInt(parts[1], 10)
				if (!isNaN(x) && !isNaN(y)) {
					coordinate = { x, y }
				}
			} else {
				// Try parsing as JSON object (fallback)
				try {
					const parsed = JSON.parse(params.coordinate)
					if (parsed && typeof parsed.x === "number" && typeof parsed.y === "number") {
						coordinate = { x: parsed.x, y: parsed.y }
					}
				} catch (error) {
					// Invalid coordinate format, leave undefined
				}
			}
		}

		// Parse size if present - XML protocol sends "width,height" format
		let size: Size | undefined
		if (params.size) {
			// Try parsing as "width,height" string first (XML protocol)
			const parts = params.size.split(",")
			if (parts.length === 2) {
				const width = parseInt(parts[0], 10)
				const height = parseInt(parts[1], 10)
				if (!isNaN(width) && !isNaN(height)) {
					size = { width, height }
				}
			} else {
				// Try parsing as JSON object (fallback)
				try {
					const parsed = JSON.parse(params.size)
					if (parsed && typeof parsed.width === "number" && typeof parsed.height === "number") {
						size = { width: parsed.width, height: parsed.height }
					}
				} catch (error) {
					// Invalid size format, leave undefined
				}
			}
		}

		return {
			action: action!,
			url: params.url,
			coordinate,
			size,
			text: params.text,
		}
	}

	async execute(params: BrowserActionParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { action, url, coordinate, text, size } = params
		const { handleError, pushToolResult } = callbacks

		// Validate action
		if (!action || !browserActions.includes(action)) {
			task.consecutiveMistakeCount++
			task.recordToolError("browser_action")
			pushToolResult(await task.sayAndCreateMissingParamError("browser_action", "action"))
			await task.browserSession.closeBrowser()
			return
		}

		try {
			let browserActionResult: BrowserActionResult = {}

			if (action === "launch") {
				if (!url) {
					task.consecutiveMistakeCount++
					task.recordToolError("browser_action")
					pushToolResult(await task.sayAndCreateMissingParamError("browser_action", "url"))
					await task.browserSession.closeBrowser()
					return
				}

				task.consecutiveMistakeCount = 0
				const didApprove = await callbacks.askApproval("browser_action_launch", url)

				if (!didApprove) {
					return
				}

				await task.say("browser_action_result", "")
				await task.browserSession.launchBrowser()
				browserActionResult = await task.browserSession.navigateToUrl(url)
			} else {
				// Validate parameters for specific actions
				if (action === "click" || action === "hover") {
					if (!coordinate) {
						task.consecutiveMistakeCount++
						task.recordToolError("browser_action")
						pushToolResult(await task.sayAndCreateMissingParamError("browser_action", "coordinate"))
						await task.browserSession.closeBrowser()
						return
					}
				}

				if (action === "type") {
					if (!text) {
						task.consecutiveMistakeCount++
						task.recordToolError("browser_action")
						pushToolResult(await task.sayAndCreateMissingParamError("browser_action", "text"))
						await task.browserSession.closeBrowser()
						return
					}
				}

				if (action === "resize") {
					if (!size) {
						task.consecutiveMistakeCount++
						task.recordToolError("browser_action")
						pushToolResult(await task.sayAndCreateMissingParamError("browser_action", "size"))
						await task.browserSession.closeBrowser()
						return
					}
				}

				task.consecutiveMistakeCount = 0

				await task.say(
					"browser_action",
					JSON.stringify({
						action: action as BrowserAction,
						coordinate: coordinate ? `${coordinate.x},${coordinate.y}` : undefined,
						text,
					} satisfies ClineSayBrowserAction),
					undefined,
					false,
				)

				switch (action) {
					case "click":
						browserActionResult = await task.browserSession.click(`${coordinate!.x},${coordinate!.y}`)
						break
					case "hover":
						browserActionResult = await task.browserSession.hover(`${coordinate!.x},${coordinate!.y}`)
						break
					case "type":
						browserActionResult = await task.browserSession.type(text!)
						break
					case "scroll_down":
						browserActionResult = await task.browserSession.scrollDown()
						break
					case "scroll_up":
						browserActionResult = await task.browserSession.scrollUp()
						break
					case "resize":
						browserActionResult = await task.browserSession.resize(`${size!.width},${size!.height}`)
						break
					case "close":
						browserActionResult = await task.browserSession.closeBrowser()
						break
				}
			}

			switch (action) {
				case "launch":
				case "click":
				case "hover":
				case "type":
				case "scroll_down":
				case "scroll_up":
				case "resize":
					await task.say("browser_action_result", JSON.stringify(browserActionResult))

					pushToolResult(
						formatResponse.toolResult(
							`The browser action has been executed. The console logs and screenshot have been captured for your analysis.\n\nConsole logs:\n${
								browserActionResult?.logs || "(No new logs)"
							}\n\n(REMEMBER: if you need to proceed to using non-\`browser_action\` tools or launch a new browser, you MUST first close cline browser. For example, if after analyzing the logs and screenshot you need to edit a file, you must first close the browser before you can use the write_to_file tool.)`,
							browserActionResult?.screenshot ? [browserActionResult.screenshot] : [],
						),
					)
					break

				case "close":
					pushToolResult(
						formatResponse.toolResult(
							`The browser has been closed. You may now proceed to using other tools.`,
						),
					)
					break
			}
		} catch (error) {
			await task.browserSession.closeBrowser()
			await handleError("executing browser action", error as Error)
		}
	}

	override async handlePartial(task: Task, block: ToolUse<"browser_action">): Promise<void> {
		const action: BrowserAction | undefined = block.params.action as BrowserAction
		const url: string | undefined = block.params.url
		const coordinate: string | undefined = block.params.coordinate
		const text: string | undefined = block.params.text

		if (!action || !browserActions.includes(action)) {
			return
		}

		if (action === "launch") {
			await task
				.ask("browser_action_launch", this.removeClosingTag("url", url, block.partial), block.partial)
				.catch(() => {})
		} else {
			await task.say(
				"browser_action",
				JSON.stringify({
					action: action as BrowserAction,
					coordinate: this.removeClosingTag("coordinate", coordinate, block.partial),
					text: this.removeClosingTag("text", text, block.partial),
				} satisfies ClineSayBrowserAction),
				undefined,
				block.partial,
			)
		}
	}
}

export const browserActionTool = new BrowserActionTool()
