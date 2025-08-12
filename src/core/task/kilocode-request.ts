import { Anthropic } from "@anthropic-ai/sdk"
import { serializeError } from "serialize-error"
import pWaitFor from "p-wait-for"
import delay from "delay"

import { TelemetryService } from "@roo-code/telemetry"
import { getApiProtocol, getModelId } from "@roo-code/types"
import { ClineApiReqCancelReason, ClineApiReqInfo } from "../../shared/ExtensionMessage"
import { formatResponse } from "../prompts/responses"
import { t } from "../../i18n"
import { findLastIndex } from "../../shared/array"
import { formatContentBlockToMarkdown } from "../../integrations/misc/export-markdown"
import { processKiloUserContentMentions } from "../mentions/processKiloUserContentMentions"
import { getEnvironmentDetails } from "../environment/getEnvironmentDetails"
import { calculateApiCostAnthropic } from "../../shared/cost"
import { parseAssistantMessage, presentAssistantMessage } from "../assistant-message"
import { defaultModeSlug } from "../../shared/modes"
import type { Task } from "./Task"

export async function makeRequest(
	task: Task,
	userContent: Anthropic.Messages.ContentBlockParam[],
	includeFileDetails: boolean = false,
): Promise<boolean> {
	interface StackFrame {
		userContent: Anthropic.Messages.ContentBlockParam[]
		includeFileDetails: boolean
		stage: "start" | "after_api_call" | "complete"
		didEndLoop?: boolean
		assistantMessage?: string
	}

	const stack: StackFrame[] = [
		{
			userContent,
			includeFileDetails,
			stage: "start",
		},
	]

	let finalResult = false

	while (stack.length > 0) {
		const frame = stack[stack.length - 1]

		if (frame.stage === "complete") {
			finalResult = frame.didEndLoop || false
			stack.pop()
			continue
		}

		if (frame.stage === "start") {
			if (task.abort) {
				throw new Error(`[KiloCode#request] task ${task.taskId}.${task.instanceId} aborted`)
			}

			if (task.consecutiveMistakeLimit > 0 && task.consecutiveMistakeCount >= task.consecutiveMistakeLimit) {
				const { response, text, images } = await task.ask(
					"mistake_limit_reached",
					t("common:errors.mistake_limit_guidance"),
				)

				if (response === "messageResponse") {
					frame.userContent.push(
						...[
							{ type: "text" as const, text: formatResponse.tooManyMistakes(text) },
							...formatResponse.imageBlocks(images),
						],
					)

					await task.say("user_feedback", text, images)

					// Track consecutive mistake errors in telemetry.
					TelemetryService.instance.captureConsecutiveMistakeError(task.taskId)
				}

				task.consecutiveMistakeCount = 0
			}

			// In this Cline request loop, we need to check if this task instance
			// has been asked to wait for a subtask to finish before continuing.
			const provider = task.providerRef.deref()

			if (task.isPaused && provider) {
				provider.log(`[subtasks] paused ${task.taskId}.${task.instanceId}`)
				await task.waitForResume()
				provider.log(`[subtasks] resumed ${task.taskId}.${task.instanceId}`)
				const currentMode = (await provider.getState())?.mode ?? defaultModeSlug

				if (currentMode !== task.pausedModeSlug) {
					// The mode has changed, we need to switch back to the paused mode.
					await provider.handleModeSwitch(task.pausedModeSlug)

					// Delay to allow mode change to take effect before next tool is executed.
					await delay(500)

					provider.log(
						`[subtasks] task ${task.taskId}.${task.instanceId} has switched back to '${task.pausedModeSlug}' from '${currentMode}'`,
					)
				}
			}

			// Getting verbose details is an expensive operation, it uses ripgrep to
			// top-down build file structure of project which for large projects can
			// take a few seconds. For the best UX we show a placeholder api_req_started
			// message with a loading spinner as this happens.

			// Determine API protocol based on provider and model
			const modelId = getModelId(task.apiConfiguration)
			const apiProtocol = getApiProtocol(task.apiConfiguration.apiProvider, modelId)

			await task.say(
				"api_req_started",
				JSON.stringify({
					request:
						frame.userContent.map((block) => formatContentBlockToMarkdown(block)).join("\n\n") +
						"\n\nLoading...",
					apiProtocol,
				}),
			)

			const {
				showRooIgnoredFiles = true,
				includeDiagnosticMessages = true,
				maxDiagnosticMessages = 50,
				maxReadFileLine = -1,
			} = (await task.providerRef.deref()?.getState()) ?? {}

			const [parsedUserContent, needsRulesFileCheck] = await processKiloUserContentMentions({
				context: (task as any).getContext(),
				userContent: frame.userContent,
				cwd: task.cwd,
				urlContentFetcher: task.urlContentFetcher,
				fileContextTracker: task.fileContextTracker,
				rooIgnoreController: task.rooIgnoreController,
				showRooIgnoredFiles,
				includeDiagnosticMessages,
				maxDiagnosticMessages,
				maxReadFileLine,
			})

			if (needsRulesFileCheck) {
				await task.say(
					"error",
					"Issue with processing the /newrule command. Double check that, if '.kilocode/rules' already exists, it's a directory and not a file. Otherwise there was an issue referencing this file/directory",
				)
			}

			const environmentDetails = await getEnvironmentDetails(task, frame.includeFileDetails)

			// Add environment details as its own text block, separate from tool
			// results.
			const finalUserContent = [...parsedUserContent, { type: "text" as const, text: environmentDetails }]

			await (task as any).addToApiConversationHistory({ role: "user", content: finalUserContent })
			TelemetryService.instance.captureConversationMessage(task.taskId, "user")

			// Since we sent off a placeholder api_req_started message to update the
			// webview while waiting to actually start the API request (to load
			// potential details for example), we need to update the text of that
			// message.
			const lastApiReqIndex = findLastIndex(task.clineMessages, (m: any) => m.say === "api_req_started")

			task.clineMessages[lastApiReqIndex].text = JSON.stringify({
				request: finalUserContent.map((block) => formatContentBlockToMarkdown(block)).join("\n\n"),
				apiProtocol,
			} satisfies ClineApiReqInfo)

			await (task as any).saveClineMessages()
			await provider?.postStateToWebview()

			try {
				let cacheWriteTokens = 0
				let cacheReadTokens = 0
				let inputTokens = 0
				let outputTokens = 0
				let totalCost: number | undefined
				let usageMissing = false

				// We can't use `api_req_finished` anymore since it's a unique case
				// where it could come after a streaming message (i.e. in the middle
				// of being updated or executed).
				// Fortunately `api_req_finished` was always parsed out for the GUI
				// anyways, so it remains solely for legacy purposes to keep track
				// of prices in tasks from history (it's worth removing a few months
				// from now).
				const updateApiReqMsg = (cancelReason?: ClineApiReqCancelReason, streamingFailedMessage?: string) => {
					if (lastApiReqIndex < 0 || !task.clineMessages[lastApiReqIndex]) {
						return
					}

					const existingData = JSON.parse(task.clineMessages[lastApiReqIndex].text || "{}")
					task.clineMessages[lastApiReqIndex].text = JSON.stringify({
						...existingData,
						tokensIn: inputTokens,
						tokensOut: outputTokens,
						cacheWrites: cacheWriteTokens,
						cacheReads: cacheReadTokens,
						cost:
							totalCost ??
							calculateApiCostAnthropic(
								task.api.getModel().info,
								inputTokens,
								outputTokens,
								cacheWriteTokens,
								cacheReadTokens,
							),
						usageMissing,
						cancelReason,
						streamingFailedMessage,
					} satisfies ClineApiReqInfo)
				}

				const abortStream = async (cancelReason: ClineApiReqCancelReason, streamingFailedMessage?: string) => {
					if (task.diffViewProvider.isEditing) {
						await task.diffViewProvider.revertChanges() // closes diff view
					}

					// if last message is a partial we need to update and save it
					const lastMessage = task.clineMessages.at(-1)

					if (lastMessage && lastMessage.partial) {
						// lastMessage.ts = Date.now() DO NOT update ts since it is used as a key for virtuoso list
						lastMessage.partial = false
						// instead of streaming partialMessage events, we do a save and post like normal to persist to disk
						console.log("updating partial message", lastMessage)
						// await task.saveClineMessages()
					}

					// Let assistant know their response was interrupted for when task is resumed
					await (task as any).addToApiConversationHistory({
						role: "assistant",
						content: [
							{
								type: "text",
								text:
									frame.assistantMessage +
									`\n\n[${
										cancelReason === "streaming_failed"
											? "Response interrupted by API Error"
											: "Response interrupted by user"
									}]`,
							},
						],
					})

					// Update `api_req_started` to have cancelled and cost, so that
					// we can display the cost of the partial stream.
					updateApiReqMsg(cancelReason, streamingFailedMessage)
					await (task as any).saveClineMessages()

					// Signals to provider that it can retrieve the saved messages
					// from disk, as abortTask can not be awaited on in nature.
					task.didFinishAbortingStream = true
				}

				// Reset streaming state.
				task.currentStreamingContentIndex = 0
				task.assistantMessageContent = []
				task.didCompleteReadingStream = false
				task.userMessageContent = []
				task.userMessageContentReady = false
				task.didRejectTool = false
				task.didAlreadyUseTool = false
				task.presentAssistantMessageLocked = false
				task.presentAssistantMessageHasPendingUpdates = false

				await task.diffViewProvider.reset()

				// Yields only if the first chunk is successful, otherwise will
				// allow the user to retry the request (most likely due to rate
				// limit error, which gets thrown on the first chunk).
				const stream = task.attemptApiRequest()
				let assistantMessage = ""
				let reasoningMessage = ""
				task.isStreaming = true

				try {
					// kilocode change: use manual iterator instead of for ... of
					const iterator = stream[Symbol.asyncIterator]()
					let item = await iterator.next()
					while (!item.done) {
						const chunk = item.value
						item = await iterator.next()

						if (!chunk) {
							// Sometimes chunk is undefined, no idea that can cause
							// it, but this workaround seems to fix it.
							continue
						}

						switch (chunk.type) {
							case "reasoning":
								reasoningMessage += chunk.text
								await task.say("reasoning", reasoningMessage, undefined, true)
								break
							case "usage":
								inputTokens += chunk.inputTokens
								outputTokens += chunk.outputTokens
								cacheWriteTokens += chunk.cacheWriteTokens ?? 0
								cacheReadTokens += chunk.cacheReadTokens ?? 0
								totalCost = chunk.totalCost
								break
							case "text": {
								assistantMessage += chunk.text

								// Parse raw assistant message into content blocks.
								const prevLength = task.assistantMessageContent.length
								task.assistantMessageContent = parseAssistantMessage(assistantMessage)

								if (task.assistantMessageContent.length > prevLength) {
									// New content we need to present, reset to
									// false in case previous content set this to true.
									task.userMessageContentReady = false
								}

								// Present content to user.
								presentAssistantMessage(task)
								break
							}
						}

						if (task.abort) {
							console.log(`aborting stream, task.abandoned = ${task.abandoned}`)

							if (!task.abandoned) {
								// Only need to gracefully abort if this instance
								// isn't abandoned (sometimes OpenRouter stream
								// hangs, in which case this would affect future
								// instances of Cline).
								await abortStream("user_cancelled")
							}

							break // Aborts the stream.
						}

						if (task.didRejectTool) {
							// `userContent` has a tool rejection, so interrupt the
							// assistant's response to present the user's feedback.
							assistantMessage += "\n\n[Response interrupted by user feedback]"
							// Instead of setting this preemptively, we allow the
							// present iterator to finish and set
							// userMessageContentReady when its ready.
							// task.userMessageContentReady = true
							break
						}

						// PREV: We need to let the request finish for openrouter to
						// get generation details.
						// UPDATE: It's better UX to interrupt the request at the
						// cost of the API cost not being retrieved.
						if (task.didAlreadyUseTool) {
							assistantMessage +=
								"\n\n[Response interrupted by a tool use result. Only one tool may be used at a time and should be placed at the end of the message.]"
							break
						}
					}

					// Create a copy of current token values to avoid race conditions
					const currentTokens = {
						input: inputTokens,
						output: outputTokens,
						cacheWrite: cacheWriteTokens,
						cacheRead: cacheReadTokens,
						total: totalCost,
					}

					const drainStreamInBackgroundToFindAllUsage = async (apiReqIndex: number) => {
						const timeoutMs = 30_000
						const startTime = performance.now()

						// Local variables to accumulate usage data without affecting the main flow
						let bgInputTokens = currentTokens.input
						let bgOutputTokens = currentTokens.output
						let bgCacheWriteTokens = currentTokens.cacheWrite
						let bgCacheReadTokens = currentTokens.cacheRead
						let bgTotalCost = currentTokens.total

						const refreshApiReqMsg = async (messageIndex: number) => {
							// Update the API request message with the latest usage data
							updateApiReqMsg()
							await (task as any).saveClineMessages()

							// Update the specific message in the webview
							const apiReqMessage = task.clineMessages[messageIndex]
							if (apiReqMessage) {
								await (task as any).updateClineMessage(apiReqMessage)
							}
						}

						// Helper function to capture telemetry and update messages
						const captureUsageData = async (
							tokens: {
								input: number
								output: number
								cacheWrite: number
								cacheRead: number
								total?: number
							},
							messageIndex: number = apiReqIndex,
						) => {
							if (
								tokens.input > 0 ||
								tokens.output > 0 ||
								tokens.cacheWrite > 0 ||
								tokens.cacheRead > 0
							) {
								// Update the shared variables atomically
								inputTokens = tokens.input
								outputTokens = tokens.output
								cacheWriteTokens = tokens.cacheWrite
								cacheReadTokens = tokens.cacheRead
								totalCost = tokens.total

								await refreshApiReqMsg(messageIndex)

								// Capture telemetry
								TelemetryService.instance.captureLlmCompletion(task.taskId, {
									inputTokens: tokens.input,
									outputTokens: tokens.output,
									cacheWriteTokens: tokens.cacheWrite,
									cacheReadTokens: tokens.cacheRead,
									cost:
										tokens.total ??
										calculateApiCostAnthropic(
											task.api.getModel().info,
											tokens.input,
											tokens.output,
											tokens.cacheWrite,
											tokens.cacheRead,
										),
								})
							}
						}

						try {
							const modelId = task.api.getModel().id
							let chunkCount = 0
							while (!item.done) {
								// Check for timeout
								const time = performance.now() - startTime
								if (task.abort || time > timeoutMs) {
									console.warn(
										`[Background Usage Collection] Cancelled after ${time}ms for model: ${modelId}, processed ${chunkCount} chunks`,
									)
									await iterator.return(undefined)
									break
								}

								const chunk = item.value
								item = await iterator.next()
								chunkCount++

								if (chunk && chunk.type === "usage") {
									bgInputTokens += chunk.inputTokens
									bgOutputTokens += chunk.outputTokens
									bgCacheWriteTokens += chunk.cacheWriteTokens ?? 0
									bgCacheReadTokens += chunk.cacheReadTokens ?? 0
									bgTotalCost = chunk.totalCost
								}
							}

							if (
								bgInputTokens > 0 ||
								bgOutputTokens > 0 ||
								bgCacheWriteTokens > 0 ||
								bgCacheReadTokens > 0
							) {
								// We have some usage data even if we didn't find a usage chunk
								await captureUsageData(
									{
										input: bgInputTokens,
										output: bgOutputTokens,
										cacheWrite: bgCacheWriteTokens,
										cacheRead: bgCacheReadTokens,
										total: bgTotalCost,
									},
									lastApiReqIndex,
								)
							} else {
								console.warn(
									`[Background Usage Collection] Suspicious: request ${apiReqIndex} is complete, but no usage info was found. Model: ${modelId}`,
								)
								usageMissing = true
								await refreshApiReqMsg(apiReqIndex)
							}
						} catch (error) {
							console.error("Error draining stream for usage data:", error)
							// Still try to capture whatever usage data we have collected so far
							if (
								bgInputTokens > 0 ||
								bgOutputTokens > 0 ||
								bgCacheWriteTokens > 0 ||
								bgCacheReadTokens > 0
							) {
								await captureUsageData(
									{
										input: bgInputTokens,
										output: bgOutputTokens,
										cacheWrite: bgCacheWriteTokens,
										cacheRead: bgCacheReadTokens,
										total: bgTotalCost,
									},
									lastApiReqIndex,
								)
							} else {
								usageMissing = true
								await refreshApiReqMsg(apiReqIndex)
							}
						}
					}

					// Start the background task and handle any errors
					drainStreamInBackgroundToFindAllUsage(lastApiReqIndex).catch((error) => {
						console.error("Background usage collection failed:", error)
					})

					frame.assistantMessage = assistantMessage
					frame.stage = "after_api_call"
				} catch (error) {
					TelemetryService.instance.captureException(error, {
						abandoned: task.abandoned,
						abort: task.abort,
						context: "request",
					})

					// Abandoned happens when extension is no longer waiting for the
					// Cline instance to finish aborting (error is thrown here when
					// any function in the for loop throws due to task.abort).
					if (!task.abandoned) {
						// If the stream failed, there's various states the task
						// could be in (i.e. could have streamed some tools the user
						// may have executed), so we just resort to replicating a
						// cancel task.

						// Check if this was a user-initiated cancellation BEFORE calling abortTask
						// If task.abort is already true, it means the user clicked cancel, so we should
						// treat this as "user_cancelled" rather than "streaming_failed"
						const cancelReason = task.abort ? "user_cancelled" : "streaming_failed"
						const streamingFailedMessage = task.abort
							? undefined
							: (error.message ?? JSON.stringify(serializeError(error), null, 2))

						// Now call abortTask after determining the cancel reason
						await task.abortTask()

						await abortStream(cancelReason, streamingFailedMessage)

						const history = await provider?.getTaskWithId(task.taskId)

						if (history) {
							await provider?.initClineWithHistoryItem(history.historyItem)
						}
					}
				} finally {
					task.isStreaming = false
				}

				// Need to call here in case the stream was aborted.
				if (task.abort || task.abandoned) {
					throw new Error(`[KiloCode#request] task ${task.taskId}.${task.instanceId} aborted`)
				}

				task.didCompleteReadingStream = true

				// Set any blocks to be complete to allow `presentAssistantMessage`
				// to finish and set `userMessageContentReady` to true.
				// (Could be a text block that had no subsequent tool uses, or a
				// text block at the very end, or an invalid tool use, etc. Whatever
				// the case, `presentAssistantMessage` relies on these blocks either
				// to be completed or the user to reject a block in order to proceed
				// and eventually set userMessageContentReady to true.)
				const partialBlocks = task.assistantMessageContent.filter((block: any) => block.partial)
				partialBlocks.forEach((block: any) => (block.partial = false))

				// Can't just do this b/c a tool could be in the middle of executing.
				// task.assistantMessageContent.forEach((e) => (e.partial = false))

				if (partialBlocks.length > 0) {
					// If there is content to update then it will complete and
					// update `task.userMessageContentReady` to true, which we
					// `pWaitFor` before making the next request. All this is really
					// doing is presenting the last partial message that we just set
					// to complete.
					presentAssistantMessage(task)
				}

				updateApiReqMsg()
				await (task as any).saveClineMessages()
				await task.providerRef.deref()?.postStateToWebview()

				// Now add to apiConversationHistory.
				// Need to save assistant responses to file before proceeding to
				// tool use since user can exit at any moment and we wouldn't be
				// able to save the assistant's response.
				let didEndLoop = false

				if (frame.assistantMessage && frame.assistantMessage.length > 0) {
					await (task as any).addToApiConversationHistory({
						role: "assistant",
						content: [{ type: "text", text: frame.assistantMessage }],
					})

					TelemetryService.instance.captureConversationMessage(task.taskId, "assistant")

					// NOTE: This comment is here for future reference - this was a
					// workaround for `userMessageContent` not getting set to true.
					// It was due to it not recursively calling for partial blocks
					// when `didRejectTool`, so it would get stuck waiting for a
					// partial block to complete before it could continue.
					// In case the content blocks finished it may be the api stream
					// finished after the last parsed content block was executed, so
					// we are able to detect out of bounds and set
					// `userMessageContentReady` to true (note you should not call
					// `presentAssistantMessage` since if the last block i
					//  completed it will be presented again).
					// const completeBlocks = task.assistantMessageContent.filter((block) => !block.partial) // If there are any partial blocks after the stream ended we can consider them invalid.
					// if (task.currentStreamingContentIndex >= completeBlocks.length) {
					// 	task.userMessageContentReady = true
					// }

					await pWaitFor(() => task.userMessageContentReady)

					// If the model did not tool use, then we need to tell it to
					// either use a tool or attempt_completion.
					const didToolUse = task.assistantMessageContent.some((block: any) => block.type === "tool_use")

					if (!didToolUse) {
						task.userMessageContent.push({ type: "text", text: formatResponse.noToolsUsed() })
						task.consecutiveMistakeCount++
					}

					// Instead of recursive call, push new frame to stack
					stack.push({
						userContent: task.userMessageContent,
						includeFileDetails: false,
						stage: "start",
					})
					continue
				} else {
					// If there's no assistant_responses, that means we got no text
					// or tool_use content blocks from API which we should assume is
					// an error.
					await task.say(
						"error",
						"Unexpected API Response: The language model did not provide any assistant messages. This may indicate an issue with the API or the model's output.",
					)

					await (task as any).addToApiConversationHistory({
						role: "assistant",
						content: [{ type: "text", text: "Failure: I did not provide a response." }],
					})
				}

				frame.didEndLoop = didEndLoop // Will always be false for now.
				frame.stage = "complete"
			} catch (error) {
				// This should never happen since the only thing that can throw an
				// error is the attemptApiRequest, which is wrapped in a try catch
				// that sends an ask where if noButtonClicked, will clear current
				// task and destroy this instance. However to avoid unhandled
				// promise rejection, we will end this loop which will end execution
				// of this instance (see `startTask`).
				frame.didEndLoop = true // Needs to be true so parent loop knows to end task.
				frame.stage = "complete"
			}
		}
	}
	return finalResult
}
