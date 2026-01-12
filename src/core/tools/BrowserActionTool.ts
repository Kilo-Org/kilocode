import { Task } from "../task/Task"
import { ToolUse, AskApproval, HandleError, PushToolResult, RemoveClosingTag } from "../../shared/tools"
import {
	BrowserAction,
	BrowserActionResult,
	browserActions,
	ClineSayBrowserAction,
} from "../../shared/ExtensionMessage"
import { formatResponse } from "../prompts/responses"
import { Anthropic } from "@anthropic-ai/sdk"
import { scaleCoordinate } from "../../shared/browserUtils"

export async function browserActionTool(
	cline: Task,
	block: ToolUse,
	askApproval: AskApproval,
	handleError: HandleError,
	pushToolResult: PushToolResult,
	removeClosingTag: RemoveClosingTag,
) {
	const action: BrowserAction | undefined = block.params.action as BrowserAction
	const url: string | undefined = block.params.url
	const coordinate: string | undefined = block.params.coordinate
	const text: string | undefined = block.params.text
	const size: string | undefined = block.params.size
	const filePath: string | undefined = block.params.path

	if (!action || !browserActions.includes(action)) {
		// checking for action to ensure it is complete and valid
		if (!block.partial) {
			// if the block is complete and we don't have a valid action cline is a mistake
			cline.consecutiveMistakeCount++
			cline.recordToolError("browser_action")
			cline.didToolFailInCurrentTurn = true
			pushToolResult(await cline.sayAndCreateMissingParamError("browser_action", "action"))
			// Do not close the browser on parameter validation errors
		}

		return
	}

	try {
		if (block.partial) {
			if (action === "launch") {
				await cline.ask("browser_action_launch", removeClosingTag("url", url), block.partial).catch(() => {})
			} else {
				await cline.say(
					"browser_action",
					JSON.stringify({
						action: action as BrowserAction,
						coordinate: removeClosingTag("coordinate", coordinate),
						text: removeClosingTag("text", text),
						size: removeClosingTag("size", size),
					} satisfies ClineSayBrowserAction),
					undefined,
					block.partial,
				)
			}
			return
		} else {
			// Initialize with empty object to avoid "used before assigned" errors
			let browserActionResult: BrowserActionResult = {}

			if (action === "launch") {
				if (!url) {
					cline.consecutiveMistakeCount++
					cline.recordToolError("browser_action")
					cline.didToolFailInCurrentTurn = true
					pushToolResult(await cline.sayAndCreateMissingParamError("browser_action", "url"))
					// Do not close the browser on parameter validation errors
					return
				}

				cline.consecutiveMistakeCount = 0
				const didApprove = await askApproval("browser_action_launch", url)

				if (!didApprove) {
					return
				}

				// NOTE: It's okay that we call cline message since the partial inspect_site is finished streaming.
				// The only scenario we have to avoid is sending messages WHILE a partial message exists at the end of the messages array.
				// For example the api_req_finished message would interfere with the partial message, so we needed to remove that.

				// Launch browser first (this triggers "Browser session opened" status message)
				await cline.browserSession.launchBrowser()

				// Create browser_action say message AFTER launching so status appears first
				await cline.say(
					"browser_action",
					JSON.stringify({
						action: "launch" as BrowserAction,
						text: url,
					} satisfies ClineSayBrowserAction),
					undefined,
					false,
				)

				browserActionResult = await cline.browserSession.navigateToUrl(url)
			} else {
				// Variables to hold validated and processed parameters
				let processedCoordinate = coordinate

				if (action === "click" || action === "hover") {
					if (!coordinate) {
						cline.consecutiveMistakeCount++
						cline.recordToolError("browser_action")
						cline.didToolFailInCurrentTurn = true
						pushToolResult(await cline.sayAndCreateMissingParamError("browser_action", "coordinate"))
						// Do not close the browser on parameter validation errors
						return // can't be within an inner switch
					}

					// Get viewport dimensions from the browser session
					const viewportSize = cline.browserSession.getViewportSize()
					const viewportWidth = viewportSize.width || 900 // default to 900 if not available
					const viewportHeight = viewportSize.height || 600 // default to 600 if not available

					// Scale coordinate from image dimensions to viewport dimensions
					try {
						processedCoordinate = scaleCoordinate(coordinate, viewportWidth, viewportHeight)
					} catch (error) {
						cline.consecutiveMistakeCount++
						cline.recordToolError("browser_action")
						cline.didToolFailInCurrentTurn = true
						pushToolResult(
							await cline.sayAndCreateMissingParamError(
								"browser_action",
								"coordinate",
								error instanceof Error ? error.message : String(error),
							),
						)
						return
					}
				}

				if (action === "type" || action === "press") {
					if (!text) {
						cline.consecutiveMistakeCount++
						cline.recordToolError("browser_action")
						cline.didToolFailInCurrentTurn = true
						pushToolResult(await cline.sayAndCreateMissingParamError("browser_action", "text"))
						// Do not close the browser on parameter validation errors
						return
					}
				}

				if (action === "resize") {
					if (!size) {
						cline.consecutiveMistakeCount++
						cline.recordToolError("browser_action")
						cline.didToolFailInCurrentTurn = true
						pushToolResult(await cline.sayAndCreateMissingParamError("browser_action", "size"))
						// Do not close the browser on parameter validation errors
						return
					}
				}

				if (action === "screenshot") {
					if (!filePath) {
						cline.consecutiveMistakeCount++
						cline.recordToolError("browser_action")
						cline.didToolFailInCurrentTurn = true
						pushToolResult(await cline.sayAndCreateMissingParamError("browser_action", "path"))
						// Do not close the browser on parameter validation errors
						return
					}
				}

				cline.consecutiveMistakeCount = 0

				// Prepare say payload; include executedCoordinate for pointer actions
				const sayPayload: ClineSayBrowserAction & { executedCoordinate?: string } = {
					action: action as BrowserAction,
					coordinate,
					text,
					size,
				}
				if ((action === "click" || action === "hover") && processedCoordinate) {
					sayPayload.executedCoordinate = processedCoordinate
				}
				await cline.say("browser_action", JSON.stringify(sayPayload), undefined, false)

				switch (action) {
					case "click":
						browserActionResult = await cline.browserSession.click(processedCoordinate!)
						break
					case "hover":
						browserActionResult = await cline.browserSession.hover(processedCoordinate!)
						break
					case "type":
						browserActionResult = await cline.browserSession.type(text!)
						break
					case "press":
						browserActionResult = await cline.browserSession.press(text!)
						break
					case "scroll_down":
						browserActionResult = await cline.browserSession.scrollDown()
						break
					case "scroll_up":
						browserActionResult = await cline.browserSession.scrollUp()
						break
					case "resize":
						browserActionResult = await cline.browserSession.resize(size!)
						break
					case "screenshot":
						browserActionResult = await cline.browserSession.saveScreenshot(filePath!, cline.cwd)
						break
					case "close":
						browserActionResult = await cline.browserSession.closeBrowser()
						break
				}
			}

			switch (action) {
				case "launch":
				case "click":
				case "hover":
				case "type":
				case "press":
				case "scroll_down":
				case "scroll_up":
				case "resize":
				case "screenshot": {
					await cline.say("browser_action_result", JSON.stringify(browserActionResult))

					const images = browserActionResult?.screenshot ? [browserActionResult.screenshot] : []

					let messageText =
						action === "screenshot"
							? `Screenshot saved to: ${filePath}`
							: `The browser action has been executed.`

					messageText += `\n\n**CRITICAL**: When providing click/hover coordinates:`
					messageText += `\n1. Screenshot dimensions != Browser viewport dimensions`
					messageText += `\n2. Measure x,y on the screenshot image you see below`
					messageText += `\n3. Use format: <coordinate>x,y@WIDTHxHEIGHT</coordinate> where WIDTHxHEIGHT is the EXACT pixel size of the screenshot image`
					messageText += `\n4. Never use the browser viewport size for WIDTHxHEIGHT - it is only for reference and is often larger than the screenshot`
					messageText += `\n5. Screenshots are often downscaled - always use the dimensions you see in the image`
					messageText += `\nExample: Viewport 1280x800, screenshot 1000x625, click (500,300) -> <coordinate>500,300@1000x625</coordinate>`

					// Include browser viewport dimensions (for reference only)
					if (browserActionResult?.viewportWidth && browserActionResult?.viewportHeight) {
						messageText += `\n\nBrowser viewport: ${browserActionResult.viewportWidth}x${browserActionResult.viewportHeight}`
					}

					// Include cursor position if available
					if (browserActionResult?.currentMousePosition) {
						messageText += `\nCursor position: ${browserActionResult.currentMousePosition}`
					}

					messageText += `\n\nConsole logs:\n${browserActionResult?.logs || "(No new logs)"}\n`

					if (images.length > 0) {
						const blocks = [
							...formatResponse.imageBlocks(images),
							{ type: "text", text: messageText } as Anthropic.TextBlockParam,
						]
						pushToolResult(blocks)
					} else {
						pushToolResult(messageText)
					}

					break
				}
				case "close":
					pushToolResult(
						formatResponse.toolResult(
							`The browser has been closed. You may now proceed to using other tools.`,
						),
					)

					break
			}

			return
		}
	} catch (error) {
		// Keep the browser session alive on errors; report the error without terminating the session
		await handleError("executing browser action", error)
		return
	}
}
