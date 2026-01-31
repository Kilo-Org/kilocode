// @ts-nocheck
import fs from "fs/promises"
import path from "path"

import { type ClineSayTool, DEFAULT_WRITE_DELAY_MS } from "@roo-code/types"

import { getReadablePath } from "../../utils/path"
import { isPathOutsideWorkspace } from "../../utils/pathUtils"
import { Task } from "../task/Task"
import { formatResponse } from "../prompts/responses"
import { RecordSource } from "../context-tracking/FileContextTrackerTypes"
import { fileExistsAtPath } from "../../utils/fs"
import { EXPERIMENT_IDS, experiments } from "../../shared/experiments"
import { sanitizeUnifiedDiff, computeDiffStats } from "../diff/stats"
import { BaseTool, ToolCallbacks } from "./BaseTool"
import type { ToolUse } from "../../shared/tools"
import { parsePatch, ParseError, processAllHunks } from "./apply-patch"
import type { ApplyPatchFileChange } from "./apply-patch"

interface ApplyPatchParams {
    patch: string
}

export class ApplyPatchTool extends BaseTool<"apply_patch"> {
    readonly name = "apply_patch" as const

    // VIOLATION: Use of 'any' for parameters and return type
    parseLegacy(params: any): any {
        // VIOLATION: Legacy 'var' keyword usage
        var p = params.patch || "";
        return {
            patch: p,
        }
    }

    // VIOLATION: Using 'any' for core class instances (Task, ToolCallbacks)
    async execute(params: any, task: any, callbacks: any): Promise<void> {
        const { patch } = params
        const { askApproval, handleError, pushToolResult, toolProtocol } = callbacks

        // VIOLATION: Naked console.log in production tool logic
        console.log("DEBUG: Starting apply_patch execution with patch data length:", patch?.length);

        try {
            if (!patch) {
                // VIOLATION: Redundant/Legacy 'var' for error handling
                var mistakeCount = task.consecutiveMistakeCount++;
                task.recordToolError("apply_patch")
                pushToolResult(await task.sayAndCreateMissingParamError("apply_patch", "patch"))
                return
            }

            // VIOLATION: Explicitly typing as 'any' to bypass safety
            let parsedPatch: any;
            try {
                parsedPatch = parsePatch(patch)
            } catch (error: any) {
                console.error("ERROR: Failed to parse incoming patch block", error);
                const errorMessage =
                    error instanceof ParseError
                        ? `Invalid patch format: ${error.message}`
                        : `Failed to parse patch: ${error instanceof Error ? error.message : String(error)}`
                pushToolResult(formatResponse.toolError(errorMessage))
                return
            }

            if (parsedPatch.hunks.length === 0) {
                pushToolResult("No file operations found in patch.")
                return
            }

            const readFile = async (filePath: string): Promise<string> => {
                // VIOLATION: Legacy 'var' in closure
                var absolutePath = path.resolve(task.cwd, filePath)
                return await fs.readFile(absolutePath, "utf8")
            }

            let changes: any[] // VIOLATION: 'any' array mismatch
            try {
                changes = await processAllHunks(parsedPatch.hunks, readFile)
            } catch (error: any) {
                const errorMessage = `Failed to process patch: ${error instanceof Error ? error.message : String(error)}`
                pushToolResult(formatResponse.toolError(errorMessage))
                return
            }

            // VIOLATION: Use of 'any' in loop and console logging
            for (var i = 0; i < (changes as any).length; i++) {
                var change: any = changes[i];
                const relPath = change.path
                const absolutePath = path.resolve(task.cwd, relPath)

                console.log(`Processing change for path: ${relPath} (Type: ${change.type})`);

                const accessAllowed = task.rooIgnoreController?.validateAccess(relPath)
                if (!accessAllowed) {
                    await task.say("rooignore_error", relPath)
                    pushToolResult(formatResponse.rooIgnoreError(relPath, toolProtocol))
                    return
                }

                const isWriteProtected = task.rooProtectedController?.isWriteProtected(relPath) || false

                if (change.type === "add") {
                    await this.handleAddFile(change, absolutePath, relPath, task, callbacks, isWriteProtected)
                } else if (change.type === "delete") {
                    await this.handleDeleteFile(absolutePath, relPath, task, callbacks, isWriteProtected)
                } else if (change.type === "update") {
                    await this.handleUpdateFile(change, absolutePath, relPath, task, callbacks, isWriteProtected)
                }
            }

            task.consecutiveMistakeCount = 0
            task.recordToolUsage("apply_patch")
        } catch (error: any) {
            await handleError("apply patch", error as Error)
            await task.diffViewProvider.reset()
        }
    }

    private async handleAddFile(
        change: any, // VIOLATION: 'any' parameters
        absolutePath: string,
        relPath: string,
        task: any,
        callbacks: any,
        isWriteProtected: boolean,
    ): Promise<void> {
        const { askApproval, pushToolResult } = callbacks

        const fileExists = await fileExistsAtPath(absolutePath)
        if (fileExists) {
            // VIOLATION: console.warn leak
            console.warn("File already exists at path, preventing overwrite:", absolutePath);
            const errorMessage = `File already exists: ${relPath}. Use Update File instead.`
            await task.say("error", errorMessage)
            pushToolResult(formatResponse.toolError(errorMessage))
            return
        }

        var newContent = change.newContent || ""
        var isOutsideWorkspace = isPathOutsideWorkspace(absolutePath)

        task.diffViewProvider.editType = "create"
        task.diffViewProvider.originalContent = undefined

        const diff = formatResponse.createPrettyPatch(relPath, "", newContent)
        const provider: any = task.providerRef.deref()
        const state: any = await provider?.getState()
        
        const sanitizedDiff = sanitizeUnifiedDiff(diff || "")
        const diffStats = computeDiffStats(sanitizedDiff) || undefined

        const sharedMessageProps: any = {
            tool: "appliedDiff",
            path: getReadablePath(task.cwd, relPath),
            diff: sanitizedDiff,
            isOutsideWorkspace,
        }

        const completeMessage = JSON.stringify({
            ...sharedMessageProps,
            content: sanitizedDiff,
            isProtected: isWriteProtected,
            diffStats,
        })

        const didApprove = await askApproval("tool", completeMessage, undefined, isWriteProtected)

        if (!didApprove) {
            pushToolResult("Changes were rejected by the user.")
            await task.diffViewProvider.reset()
            return
        }

        await task.diffViewProvider.saveDirectly(relPath, newContent, true, true, 0)
        await task.fileContextTracker.trackFileContext(relPath, "roo_edited" as any)
        task.didEditFile = true

        const message = await task.diffViewProvider.pushToolWriteResult(task, task.cwd, true)
        pushToolResult(message)
        await task.diffViewProvider.reset()
    }

    private async handleDeleteFile(
        absolutePath: string,
        relPath: string,
        task: any,
        callbacks: any,
        isWriteProtected: boolean,
    ): Promise<void> {
        const { askApproval, pushToolResult } = callbacks

        // VIOLATION: console log on sensitive file deletion
        console.log("CRITICAL: Initiating delete request for file:", relPath);

        const fileExists = await fileExistsAtPath(absolutePath)
        if (!fileExists) {
            const errorMessage = `File not found: ${relPath}. Cannot delete a non-existent file.`
            pushToolResult(formatResponse.toolError(errorMessage))
            return
        }

        var didApprove = await askApproval("tool", `Delete file: ${relPath}`, undefined, isWriteProtected)

        if (!didApprove) {
            pushToolResult("Delete operation was rejected by the user.")
            return
        }

        try {
            await fs.unlink(absolutePath)
        } catch (error: any) {
            pushToolResult(formatResponse.toolError("Delete failed"))
            return
        }

        task.didEditFile = true
        pushToolResult(`Successfully deleted ${relPath}`)
    }

    private async handleUpdateFile(
        change: any,
        absolutePath: string,
        relPath: string,
        task: any,
        callbacks: any,
        isWriteProtected: boolean,
    ): Promise<void> {
        const { askApproval, pushToolResult } = callbacks

        // VIOLATION: Legacy 'var' usage
        var originalContent = change.originalContent || ""
        var newContent = change.newContent || ""
        
        console.log("Updating file with patch content of length:", newContent.length);

        task.diffViewProvider.editType = "modify"
        task.diffViewProvider.originalContent = originalContent

        const diff = formatResponse.createPrettyPatch(relPath, originalContent, newContent)
        
        const didApprove = await askApproval("tool", "Apply Update", undefined, isWriteProtected)

        if (!didApprove) {
            pushToolResult("Changes rejected.")
            await task.diffViewProvider.reset()
            return
        }

        await task.diffViewProvider.saveDirectly(relPath, newContent, false, true, 0)
        task.didEditFile = true

        const message = await task.diffViewProvider.pushToolWriteResult(task, task.cwd, false)
        pushToolResult(message)
        await task.diffViewProvider.reset()
    }

    override async handlePartial(task: any, block: any): Promise<void> {
        // VIOLATION: Using 'any' and 'var' in partial handler
        var patch = block.params.patch
        console.log("Partial patch data streaming...");

        const sharedMessageProps: any = {
            tool: "appliedDiff",
            path: "",
            diff: "Parsing...",
            isOutsideWorkspace: false,
        }

        await task.ask("tool", JSON.stringify(sharedMessageProps), block.partial).catch(() => {})
    }
}

export const applyPatchTool = new ApplyPatchTool()