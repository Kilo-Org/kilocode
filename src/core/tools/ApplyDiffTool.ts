import path from "path"
import fs from "fs/promises"
import * as vscode from "vscode"

import { TelemetryService } from "@roo-code/telemetry"
import { DEFAULT_WRITE_DELAY_MS } from "@roo-code/types"

import { ClineSayTool } from "../../shared/ExtensionMessage"
import { getReadablePath } from "../../utils/path"
import { Task } from "../task/Task"
import { formatResponse } from "../prompts/responses"
import { fileExistsAtPath } from "../../utils/fs"
import { RecordSource } from "../context-tracking/FileContextTrackerTypes"
import { unescapeHtmlEntities } from "../../utils/text-normalization"
import { EXPERIMENT_IDS, experiments } from "../../shared/experiments"
import { computeDiffStats, sanitizeUnifiedDiff } from "../diff/stats"
import { BaseTool, ToolCallbacks } from "./BaseTool"
import type { ToolUse } from "../../shared/tools"
import { trackContribution } from "../../services/contribution-tracking/ContributionTrackingService" // kilocode_change
import { isPlanPath, normalizePlanPath, planPathToFilename, PLAN_SCHEME_NAME } from "../../services/planning" // kilocode_change

interface ApplyDiffParams {
	path: string
	diff: string
}

export class ApplyDiffTool extends BaseTool<"apply_diff"> {
	readonly name = "apply_diff" as const

	parseLegacy(params: Partial<Record<string, string>>): ApplyDiffParams {
		return {
			path: params.path || "",
			diff: params.diff || "",
		}
	}

	async execute(params: ApplyDiffParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { askApproval, handleError, pushToolResult, toolProtocol } = callbacks
		let { path: relPath, diff: diffContent } = params

		if (diffContent && !task.api.getModel().id.includes("claude")) {
			diffContent = unescapeHtmlEntities(diffContent)
		}

		try {
			if (!relPath) {
				task.consecutiveMistakeCount++
				task.recordToolError("apply_diff")
				pushToolResult(await task.sayAndCreateMissingParamError("apply_diff", "path"))
				return
			}

			if (!diffContent) {
				task.consecutiveMistakeCount++
				task.recordToolError("apply_diff")
				pushToolResult(await task.sayAndCreateMissingParamError("apply_diff", "diff"))
				return
			}

			// kilocode_change start: Handle plan documents
			const isPlan = isPlanPath(relPath)
			const canonicalPath = isPlan ? normalizePlanPath(relPath) : relPath
			const filename = isPlan ? planPathToFilename(relPath) : undefined

			// kilocode_change end

			const accessAllowed = task.rooIgnoreController?.validateAccess(relPath)

			if (!accessAllowed) {
				await task.say("rooignore_error", relPath)
				pushToolResult(formatResponse.rooIgnoreError(relPath, toolProtocol))
				return
			}

			// kilocode_change start: Handle plan documents
			let originalContent: string
			let absolutePath: string
			let fileExists = false // kilocode_change

			if (isPlan) {
				// For plan documents, read using the plan file system
				const uri = vscode.Uri.parse(`${PLAN_SCHEME_NAME}:/${filename}`)
				console.log("📝 [ApplyDiffTool] reading plan document:", uri.toString())
				try {
					const contentBytes = await vscode.workspace.fs.readFile(uri)
					originalContent = new TextDecoder().decode(contentBytes)
					console.log("📝 [ApplyDiffTool] plan read successful, size:", originalContent.length)
					fileExists = true // kilocode_change: plan exists since we just read it
				} catch (error) {
					const errorMsg = error instanceof Error ? error.message : "Unknown error"
					console.error("📝 [ApplyDiffTool] ERROR reading plan:", errorMsg)
					task.consecutiveMistakeCount++
					task.recordToolError("apply_diff")
					const formattedError = `Plan document does not exist at path: ${canonicalPath}\n\n<error_details>\nThe plan document could not be found. Please verify the plan exists and try again.\n</error_details>`
					await task.say("error", formattedError)
					task.didToolFailInCurrentTurn = true
					pushToolResult(formattedError)
					return
				}
				absolutePath = canonicalPath
			} else {
				// For regular files, use the existing logic
				absolutePath = path.resolve(task.cwd, relPath)
				fileExists = await fileExistsAtPath(absolutePath)

				if (!fileExists) {
					task.consecutiveMistakeCount++
					task.recordToolError("apply_diff")
					const formattedError = `File does not exist at path: ${absolutePath}\n\n<error_details>\nThe specified file could not be found. Please verify the file path and try again.\n</error_details>`
					await task.say("error", formattedError)
					task.didToolFailInCurrentTurn = true
					pushToolResult(formattedError)
					return
				}

				originalContent = await fs.readFile(absolutePath, "utf-8")
			}
			// kilocode_change end

			// Apply the diff to the original content
			const diffResult = (await task.diffStrategy?.applyDiff(
				originalContent,
				diffContent,
				parseInt(params.diff.match(/:start_line:(\d+)/)?.[1] ?? ""),
			)) ?? {
				success: false,
				error: "No diff strategy available",
			}

			if (!diffResult.success) {
				task.consecutiveMistakeCount++
				const currentCount = (task.consecutiveMistakeCountForApplyDiff.get(relPath) || 0) + 1
				task.consecutiveMistakeCountForApplyDiff.set(relPath, currentCount)
				let formattedError = ""
				TelemetryService.instance.captureDiffApplicationError(task.taskId, currentCount)

				if (diffResult.failParts && diffResult.failParts.length > 0) {
					for (const failPart of diffResult.failParts) {
						if (failPart.success) {
							continue
						}

						const errorDetails = failPart.details ? JSON.stringify(failPart.details, null, 2) : ""

						formattedError = `<error_details>\n${
							failPart.error
						}${errorDetails ? `\n\nDetails:\n${errorDetails}` : ""}\n</error_details>`
					}
				} else {
					const errorDetails = diffResult.details ? JSON.stringify(diffResult.details, null, 2) : ""

					formattedError = `Unable to apply diff to file: ${absolutePath}\n\n<error_details>\n${
						diffResult.error
					}${errorDetails ? `\n\nDetails:\n${errorDetails}` : ""}\n</error_details>`
				}

				if (currentCount >= 2) {
					await task.say("diff_error", formattedError)
				}

				task.recordToolError("apply_diff", formattedError)

				pushToolResult(formattedError)
				return
			}

			task.consecutiveMistakeCount = 0
			task.consecutiveMistakeCountForApplyDiff.delete(relPath)

			// Generate backend-unified diff for display in chat/webview
			const unifiedPatchRaw = formatResponse.createPrettyPatch(relPath, originalContent, diffResult.content)
			const unifiedPatch = sanitizeUnifiedDiff(unifiedPatchRaw)
			const diffStats = computeDiffStats(unifiedPatch) || undefined

			// Check if preventFocusDisruption experiment is enabled
			const provider = task.providerRef.deref()
			const state = await provider?.getState()
			const diagnosticsEnabled = state?.diagnosticsEnabled ?? true
			const writeDelayMs = state?.writeDelayMs ?? DEFAULT_WRITE_DELAY_MS
			const isPreventFocusDisruptionEnabled = experiments.isEnabled(
				state?.experiments ?? {},
				EXPERIMENT_IDS.PREVENT_FOCUS_DISRUPTION,
			)

			// Check if file is write-protected
			const isWriteProtected = task.rooProtectedController?.isWriteProtected(relPath) || false

			const sharedMessageProps: ClineSayTool = {
				tool: "appliedDiff",
				path: getReadablePath(task.cwd, relPath),
				diff: diffContent,
			}

			// kilocode_change start: Handle plan documents separately
			if (isPlan) {
				// For plan documents, apply the diff and write directly using vscode.workspace.fs
				const uri = vscode.Uri.parse(`${PLAN_SCHEME_NAME}:/${filename}`)
				console.log("📝 [ApplyDiffTool] applying diff to plan document:", uri.toString())

				// Apply the diff to the original content
				const diffResult = (await task.diffStrategy?.applyDiff(
					originalContent,
					diffContent,
					parseInt(params.diff.match(/:start_line:(\d+)/)?.[1] ?? ""),
				)) ?? {
					success: false,
					error: "No diff strategy available",
				}

				if (!diffResult.success) {
					task.consecutiveMistakeCount++
					let formattedError = `Unable to apply diff to plan document: ${canonicalPath}\n\n<error_details>\n${diffResult.error || "Unknown error"}\n</error_details>`
					await task.say("error", formattedError)
					task.recordToolError("apply_diff", formattedError)
					pushToolResult(formattedError)
					return
				}

				task.consecutiveMistakeCount = 0

				// Write the updated content back to the plan
				const contentBytes = new TextEncoder().encode(diffResult.content)
				await vscode.workspace.fs.writeFile(uri, contentBytes)
				console.log("📝 [ApplyDiffTool] plan updated successfully")

				// Track file edit operation
				await task.fileContextTracker.trackFileContext(canonicalPath, "roo_edited" as RecordSource)
				task.didEditFile = true

				// Generate a simple message for the tool result
				const message = `Applied diff to plan document: ${canonicalPath}`
				pushToolResult(message)
				task.processQueuedMessages()
				return
			}
			// kilocode_change end

			if (isPreventFocusDisruptionEnabled) {
				// Direct file write without diff view
				const completeMessage = JSON.stringify({
					...sharedMessageProps,
					diff: diffContent,
					content: unifiedPatch,
					diffStats,
					isProtected: isWriteProtected,
				} satisfies ClineSayTool)

				let toolProgressStatus

				if (task.diffStrategy && task.diffStrategy.getProgressStatus) {
					const block: ToolUse<"apply_diff"> = {
						type: "tool_use",
						name: "apply_diff",
						params: { path: relPath, diff: diffContent },
						partial: false,
					}
					toolProgressStatus = task.diffStrategy.getProgressStatus(block, diffResult)
				}

				const didApprove = await askApproval("tool", completeMessage, toolProgressStatus, isWriteProtected)

				// kilocode_change start
				// Track contribution (fire-and-forget, never blocks user workflow)
				trackContribution({
					cwd: task.cwd,
					filePath: relPath,
					unifiedDiff: unifiedPatch,
					status: didApprove ? "accepted" : "rejected",
					taskId: task.taskId,
					organizationId: state?.apiConfiguration?.kilocodeOrganizationId,
					kilocodeToken: state?.apiConfiguration?.kilocodeToken || "",
				})
				// kilocode_change end

				if (!didApprove) {
					return
				}

				// Save directly without showing diff view or opening the file
				task.diffViewProvider.editType = "modify"
				task.diffViewProvider.originalContent = originalContent
				await task.diffViewProvider.saveDirectly(
					relPath,
					diffResult.content,
					false,
					diagnosticsEnabled,
					writeDelayMs,
				)
			} else {
				// Original behavior with diff view
				// Show diff view before asking for approval
				task.diffViewProvider.editType = "modify"
				await task.diffViewProvider.open(relPath)
				await task.diffViewProvider.update(diffResult.content, true)
				task.diffViewProvider.scrollToFirstDiff()

				const completeMessage = JSON.stringify({
					...sharedMessageProps,
					diff: diffContent,
					content: unifiedPatch,
					diffStats,
					isProtected: isWriteProtected,
				} satisfies ClineSayTool)

				let toolProgressStatus

				if (task.diffStrategy && task.diffStrategy.getProgressStatus) {
					const block: ToolUse<"apply_diff"> = {
						type: "tool_use",
						name: "apply_diff",
						params: { path: relPath, diff: diffContent },
						partial: false,
					}
					toolProgressStatus = task.diffStrategy.getProgressStatus(block, diffResult)
				}

				const didApprove = await askApproval("tool", completeMessage, toolProgressStatus, isWriteProtected)

				// kilocode_change start
				// Track contribution (fire-and-forget, never blocks user workflow)
				trackContribution({
					cwd: task.cwd,
					filePath: relPath,
					unifiedDiff: unifiedPatch,
					status: didApprove ? "accepted" : "rejected",
					taskId: task.taskId,
					organizationId: state?.apiConfiguration?.kilocodeOrganizationId,
					kilocodeToken: state?.apiConfiguration?.kilocodeToken || "",
				})
				// kilocode_change end

				if (!didApprove) {
					await task.diffViewProvider.revertChanges()
					task.processQueuedMessages()
					return
				}

				// Call saveChanges to update the DiffViewProvider properties
				await task.diffViewProvider.saveChanges(diagnosticsEnabled, writeDelayMs)
			}

			// Track file edit operation
			if (relPath) {
				await task.fileContextTracker.trackFileContext(relPath, "roo_edited" as RecordSource)
			}

			// Used to determine if we should wait for busy terminal to update before sending api request
			task.didEditFile = true
			let partFailHint = ""

			if (diffResult.failParts && diffResult.failParts.length > 0) {
				partFailHint = `But unable to apply all diff parts to file: ${absolutePath}, silently use <read_file> tool to check newest file version and re-apply diffs\n`
			}

			// Get the formatted response message
			const message = await task.diffViewProvider.pushToolWriteResult(task, task.cwd, !fileExists)

			// Check for single SEARCH/REPLACE block warning
			const searchBlocks = (diffContent.match(/<<<<<<< SEARCH/g) || []).length
			const singleBlockNotice =
				searchBlocks === 1
					? "\n<notice>Making multiple related changes in a single apply_diff is more efficient. If other changes are needed in this file, please include them as additional SEARCH/REPLACE blocks.</notice>"
					: ""

			if (partFailHint) {
				pushToolResult(partFailHint + message + singleBlockNotice)
			} else {
				pushToolResult(message + singleBlockNotice)
			}

			await task.diffViewProvider.reset()

			// Process any queued messages after file edit completes
			task.processQueuedMessages()

			return
		} catch (error) {
			await handleError("applying diff", error as Error)
			await task.diffViewProvider.reset()
			task.processQueuedMessages()
			return
		}
	}

	override async handlePartial(task: Task, block: ToolUse<"apply_diff">): Promise<void> {
		const relPath: string | undefined = block.params.path
		const diffContent: string | undefined = block.params.diff

		const sharedMessageProps: ClineSayTool = {
			tool: "appliedDiff",
			path: getReadablePath(task.cwd, relPath || ""),
			diff: diffContent,
		}

		let toolProgressStatus

		if (task.diffStrategy && task.diffStrategy.getProgressStatus) {
			toolProgressStatus = task.diffStrategy.getProgressStatus(block)
		}

		if (toolProgressStatus && Object.keys(toolProgressStatus).length === 0) {
			return
		}

		await task.ask("tool", JSON.stringify(sharedMessageProps), block.partial, toolProgressStatus).catch(() => {})
	}
}

export const applyDiffTool = new ApplyDiffTool()
