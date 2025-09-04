// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

package ai.kilocode.jetbrains.git

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.progress.ProgressIndicator
import com.intellij.openapi.progress.ProgressManager
import com.intellij.openapi.progress.Task
import com.intellij.openapi.project.Project
import com.intellij.openapi.ui.Messages
import com.intellij.openapi.vcs.CheckinProjectPanel
import com.intellij.openapi.vcs.changes.CommitContext
import com.intellij.openapi.vcs.checkin.CheckinHandler
import com.intellij.openapi.vcs.ui.RefreshableOnComponent
import com.intellij.ui.components.JBCheckBox
import com.intellij.util.ui.FormBuilder
import ai.kilocode.jetbrains.core.PluginContext
import ai.kilocode.jetbrains.core.ServiceProxyRegistry
import ai.kilocode.jetbrains.git.WorkspaceResolver
import ai.kilocode.jetbrains.ipc.proxy.LazyPromise
import java.awt.BorderLayout
import java.io.File
import java.util.concurrent.CompletableFuture
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException
import javax.swing.JButton
import javax.swing.JPanel

/**
 * CheckinHandler that adds commit message generation capabilities to the JetBrains commit dialog.
 * Provides a "Generate Message" button and "Auto-generate" checkbox for seamless integration
 * with the commit workflow.
 */
class CommitMessageHandler(
    private val panel: CheckinProjectPanel,
    private val commitContext: CommitContext
) : CheckinHandler() {
    
    private val logger: Logger = Logger.getInstance(CommitMessageHandler::class.java)
    private val commandId: String = "kilo-code.generateCommitMessageForExternal"
    
    private lateinit var generateButton: JButton
    private lateinit var autoGenerateCheckBox: JBCheckBox
    private var isGenerating = false

    /**
     * Creates and returns the configuration panel that will be added to the commit dialog.
     * This panel contains the "Generate Message" button and "Auto-generate" checkbox.
     *
     * @return The UI panel to be integrated into the commit dialog
     */
    override fun getBeforeCheckinConfigurationPanel(): RefreshableOnComponent? {
        return CommitMessageConfigPanel()
    }

    /**
     * Private inner class that implements RefreshableOnComponent to provide the commit message
     * configuration panel. This class handles UI component creation, state management, and
     * refresh logic for the commit dialog integration.
     */
    private inner class CommitMessageConfigPanel : RefreshableOnComponent {
        private val configPanel: JPanel

        init {
            // Create UI components
            generateButton = JButton("Generate Message").apply {
                addActionListener { generateCommitMessage() }
                toolTipText = "Generate AI-powered commit message based on current changes"
            }
            
            autoGenerateCheckBox = JBCheckBox("Auto-generate commit messages", false).apply {
                toolTipText = "Automatically generate commit messages when the field is empty"
            }
            
            // Create the panel layout
            configPanel = JPanel(BorderLayout()).apply {
                val formBuilder = FormBuilder.createFormBuilder()
                    .addComponent(generateButton)
                    .addComponent(autoGenerateCheckBox)
                
                add(formBuilder.panel, BorderLayout.CENTER)
            }
        }

        override fun getComponent(): JPanel = configPanel
        
        override fun refresh() {
            updateButtonState()
        }
        
        override fun saveState() {
            // Save auto-generate preference if needed
        }
        
        override fun restoreState() {
            // Restore auto-generate preference if needed
        }
    }

    /**
     * Called before the commit is performed. If auto-generate is enabled and no commit message
     * exists, automatically generates one.
     *
     * @return CONTINUE to proceed with commit, CANCEL to abort
     */
    override fun beforeCheckin(): ReturnResult {
        if (autoGenerateCheckBox.isSelected && panel.commitMessage.isNullOrBlank() && !isGenerating) {
            // Auto-generate commit message if enabled and field is empty
            generateCommitMessage()
            return ReturnResult.CANCEL // Cancel this commit attempt, user can retry after generation
        }
        
        return ReturnResult.CONTINUE
    }

    /**
     * Generates a commit message using the same logic as GitCommitMessageAction.
     * Updates the commit message field directly in the commit dialog.
     */
    private fun generateCommitMessage() {
        val project = panel.project
        
        if (isGenerating) {
            logger.info("Commit message generation already in progress")
            return
        }
        
        logger.info("Generating commit message from commit dialog")
        
        // Check if there are changes to commit
        if (panel.selectedChanges.isEmpty()) {
            Messages.showInfoMessage(
                project,
                "No changes selected to generate a commit message.",
                "Generate Commit Message"
            )
            return
        }
        
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
        
        // Determine if we should analyze staged or unstaged changes
        val staged = panel.selectedChanges.any { it.afterRevision != null }
        
        // Execute commit message generation with progress indication
        isGenerating = true
        updateButtonState()
        
        ProgressManager.getInstance().run(object : Task.Backgroundable(
            project,
            "Generating Commit Message...",
            true
        ) {
            override fun run(indicator: ProgressIndicator) {
                indicator.text = "Analyzing Git changes..."
                indicator.isIndeterminate = true
                
                try {
                    executeCommitMessageGeneration(project, workspacePath, staged, indicator)
                } catch (e: Exception) {
                    logger.error("Error generating commit message", e)
                    ApplicationManager.getApplication().invokeLater {
                        isGenerating = false
                        updateButtonState()
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
     * Executes the commit message generation by calling the VSCode extension via RPC.
     *
     * @param project The current project
     * @param workspacePath The absolute path to the Git repository
     * @param staged Whether to analyze staged or unstaged changes
     * @param indicator Progress indicator for user feedback
     */
    private fun executeCommitMessageGeneration(
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
                isGenerating = false
                updateButtonState()
                handleCommitMessageResult(project, result)
            }
        }, { error ->
            if (!timeoutFuture.isDone) {
                timeoutFuture.completeExceptionally(error as? Throwable ?: RuntimeException(error.toString()))
            }
            ApplicationManager.getApplication().invokeLater {
                isGenerating = false
                updateButtonState()
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
                    isGenerating = false
                    updateButtonState()
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
     * Sets the generated message directly in the commit dialog.
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

            // Happy path: Success case - set the message in the commit dialog
            logger.info("Successfully generated and set commit message: $message")
            panel.setCommitMessage(message)

        } catch (e: Exception) {
            logger.error("Error handling commit message result", e)
            Messages.showErrorMessage(
                project,
                "Error processing generated commit message: ${e.message}",
                "Generate Commit Message Error"
            )
        }
    }

    /**
     * Updates the state of the generate button based on current conditions.
     */
    private fun updateButtonState() {
        generateButton.isEnabled = !isGenerating && panel.selectedChanges.isNotEmpty()
        generateButton.text = if (isGenerating) "Generating..." else "Generate Message"
    }

}