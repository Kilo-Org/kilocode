// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

package ai.kilocode.jetbrains.actions

import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.progress.ProgressIndicator
import com.intellij.openapi.progress.ProgressManager
import com.intellij.openapi.progress.Task
import com.intellij.openapi.project.Project
import com.intellij.openapi.ui.Messages
import com.intellij.openapi.vcs.changes.ChangeListManager
import com.intellij.openapi.vfs.VirtualFileManager
import ai.kilocode.jetbrains.core.PluginContext
import ai.kilocode.jetbrains.core.ServiceProxyRegistry
import ai.kilocode.jetbrains.git.WorkspaceResolver
import ai.kilocode.jetbrains.ipc.proxy.LazyPromise
import java.io.File
import java.util.concurrent.CompletableFuture
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException

/**
 * Action that generates AI-powered commit messages for Git repositories.
 * Integrates with JetBrains VCS system to detect changes and uses RPC
 * communication to call the VSCode extension's commit message generation.
 */
class GitCommitMessageAction : AnAction("Generate Commit Message") {
    private val logger: Logger = Logger.getInstance(GitCommitMessageAction::class.java)
    private val commandId: String = "kilo-code.generateCommitMessageForExternal"

    /**
     * Updates the action's presentation based on the current project state.
     * The action is enabled only when there are Git changes available to commit.
     *
     * @param e The action event containing context information
     */
    override fun update(e: AnActionEvent) {
        val project = e.project
        val presentation = e.presentation
        
        if (project == null) {
            presentation.isEnabled = false
            presentation.description = "No project available"
            return
        }

        val changeListManager = ChangeListManager.getInstance(project)
        val hasChanges = changeListManager.allChanges.isNotEmpty()
        
        presentation.isEnabled = hasChanges
        presentation.description = if (hasChanges) {
            "Generate AI-powered commit message for current changes"
        } else {
            "No changes available to commit"
        }
    }

    /**
     * Performs the action when the Generate Commit Message action is triggered.
     * Detects Git changes, calls the VSCode extension via RPC, and displays the result.
     *
     * @param e The action event containing context information
     */
    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project
        if (project == null) {
            logger.warn("No project available for commit message generation")
            return
        }

        logger.info("Generate Commit Message action triggered")

        // Check if there are changes to commit
        val changeListManager = ChangeListManager.getInstance(project)
        if (changeListManager.allChanges.isEmpty()) {
            Messages.showInfoMessage(
                project,
                "No changes available to generate a commit message.",
                "Generate Commit Message"
            )
            return
        }

        // Determine if we should analyze staged or unstaged changes
        val hasUnstagedChanges = changeListManager.allChanges.any { !it.beforeRevision?.file?.path.isNullOrEmpty() }
        val staged = !hasUnstagedChanges // Default to staged if no unstaged changes

        // Get workspace path
        val workspacePath = WorkspaceResolver.getWorkspacePath(project)
        if (workspacePath == null) {
            Messages.showErrorMessage(
                project,
                "Could not determine workspace path for commit message generation.",
                "Generate Commit Message Error"
            )
            return
        }

        // Execute commit message generation with progress indication
        ProgressManager.getInstance().run(object : Task.Backgroundable(
            project,
            "Generating Commit Message...",
            true
        ) {
            override fun run(indicator: ProgressIndicator) {
                indicator.text = "Analyzing Git changes..."
                indicator.isIndeterminate = true

                try {
                    generateCommitMessage(project, workspacePath, staged, indicator)
                } catch (e: Exception) {
                    logger.error("Error generating commit message", e)
                    ApplicationManager.getApplication().invokeLater {
                        Messages.showErrorMessage(
                            project,
                            "Failed to generate commit message: ${e.message}",
                            "Generate Commit Message Error"
                        )
                    }
                }
            }
        })
    }

    /**
     * Generates a commit message by calling the VSCode extension via RPC.
     *
     * @param project The current project
     * @param workspacePath The absolute path to the Git repository
     * @param staged Whether to analyze staged or unstaged changes
     * @param indicator Progress indicator for user feedback
     */
    private fun generateCommitMessage(
        project: Project,
        workspacePath: String,
        staged: Boolean,
        indicator: ProgressIndicator
    ) {
        indicator.text = "Connecting to AI service..."

        // Get RPC proxy for command execution
        val proxy = project.getService(PluginContext::class.java)
            ?.getRPCProtocol()
            ?.getProxy(ServiceProxyRegistry.ExtHostContext.ExtHostCommands)

        if (proxy == null) {
            throw RuntimeException("Could not establish connection to VSCode extension")
        }

        // Prepare command parameters
        val params = mapOf(
            "workspacePath" to workspacePath,
            "staged" to staged
        )

        indicator.text = "Generating commit message with AI..."

        // Execute the command via RPC with timeout handling
        val promise: LazyPromise = proxy.executeContributedCommand(commandId, listOf(params))
        val timeoutFuture = CompletableFuture<Any?>()
        
        // Set up timeout (30 seconds for AI generation)
        val timeoutTask = ApplicationManager.getApplication().executeOnPooledThread {
            try {
                Thread.sleep(30000) // 30 seconds
                if (!timeoutFuture.isDone) {
                    timeoutFuture.completeExceptionally(
                        TimeoutException("Commit message generation timed out after 30 seconds")
                    )
                }
            } catch (e: InterruptedException) {
                // Thread was interrupted, likely because operation completed
            }
        }
        
        // Handle the response with timeout
        promise.then({ result ->
            if (!timeoutFuture.isDone) {
                timeoutFuture.complete(result)
            }
            ApplicationManager.getApplication().invokeLater {
                handleCommitMessageResult(project, result)
            }
        }, { error ->
            if (!timeoutFuture.isDone) {
                timeoutFuture.completeExceptionally(error as? Throwable ?: RuntimeException(error.toString()))
            }
            ApplicationManager.getApplication().invokeLater {
                logger.error("RPC call failed", error as? Throwable)
                Messages.showErrorMessage(
                    project,
                    "Failed to generate commit message: ${error}",
                    "Generate Commit Message Error"
                )
            }
        })
        
        // Handle timeout scenarios
        timeoutFuture.handle { result, throwable ->
            if (throwable is TimeoutException) {
                logger.warn("Commit message generation timed out", throwable)
                ApplicationManager.getApplication().invokeLater {
                    Messages.showErrorMessage(
                        project,
                        "The commit message generation request timed out. Please check if the VSCode extension is running and try again.",
                        "Generate Commit Message Timeout"
                    )
                }
                // Interrupt the timeout task since we're handling the timeout
                timeoutTask.cancel(true)
            }
            null
        }
    }

    /**
     * Handles the result from the commit message generation command.
     *
     * @param project The current project
     * @param result The result from the VSCode extension command
     */
    private fun handleCommitMessageResult(project: Project, result: Any?) {
        // Guard clause: Handle exceptions early
        try {
            // Guard clause: Check for invalid result format early
            if (result !is Map<*, *>) {
                logger.warn("Received unexpected response format: ${result?.javaClass?.simpleName}")
                Messages.showErrorMessage(
                    project,
                    "Received unexpected response format from commit message generation",
                    "Generate Commit Message Error"
                )
                return
            }

            // Extract response data
            val message = result["message"] as? String
            val error = result["error"] as? String

            // Guard clause: Handle error response early
            if (error != null) {
                logger.warn("Commit message generation failed with error: $error")
                Messages.showErrorMessage(
                    project,
                    "Failed to generate commit message: $error",
                    "Generate Commit Message Error"
                )
                return
            }

            // Guard clause: Handle missing message early
            if (message == null) {
                logger.warn("Received response without message or error field")
                Messages.showErrorMessage(
                    project,
                    "Received invalid response from commit message generation",
                    "Generate Commit Message Error"
                )
                return
            }

            // Happy path: Success case
            logger.info("Successfully generated commit message: $message")
            Messages.showInfoMessage(
                project,
                "Generated commit message:\n\n$message",
                "Generated Commit Message"
            )

        } catch (e: Exception) {
            logger.error("Error handling commit message result", e)
            Messages.showErrorMessage(
                project,
                "Error processing generated commit message: ${e.message}",
                "Generate Commit Message Error"
            )
        }
    }

}