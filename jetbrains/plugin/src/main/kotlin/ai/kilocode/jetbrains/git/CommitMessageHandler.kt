// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

package ai.kilocode.jetbrains.git

import ai.kilocode.jetbrains.actions.GitCommitMessageAction
import ai.kilocode.jetbrains.i18n.I18n
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.application.ModalityState
import com.intellij.openapi.application.ReadAction
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.progress.ProcessCanceledException
import com.intellij.openapi.progress.ProgressIndicator
import com.intellij.openapi.progress.ProgressManager
import com.intellij.openapi.progress.Task
import com.intellij.openapi.project.Project
import com.intellij.openapi.ui.Messages
import com.intellij.openapi.actionSystem.DataContext
import com.intellij.openapi.actionSystem.impl.SimpleDataContext
import com.intellij.openapi.vcs.CheckinProjectPanel
import com.intellij.openapi.vcs.changes.CommitContext
import com.intellij.openapi.vcs.checkin.CheckinHandler
import com.intellij.openapi.vcs.checkin.CheckinHandler.ReturnResult
import com.intellij.openapi.vcs.ui.RefreshableOnComponent
import com.intellij.openapi.vcs.ui.Refreshable
import com.intellij.util.ui.FormBuilder
import kotlinx.coroutines.*
import java.awt.BorderLayout
import java.util.concurrent.CompletableFuture
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException
import javax.swing.JButton
import javax.swing.JPanel

/**
 * CheckinHandler that adds commit message generation capabilities to the JetBrains commit dialog.
 * Provides a "Generate Message" button for seamless integration with the commit workflow.
 */
class CommitMessageHandler(
    private val panel: CheckinProjectPanel,
    private val commitContext: CommitContext,
) : CheckinHandler() {

    private val logger: Logger = Logger.getInstance(CommitMessageHandler::class.java)
    private val commitMessageService by lazy { CommitMessageService.getInstance(panel.project) }
    private val fileDiscoveryService = FileDiscoveryService()

    private lateinit var generateButton: JButton
    private var isGenerating = false

    /**
     * Creates and returns the configuration panel that will be added to the commit dialog.
     * This panel contains the "Generate Message" button.
     *
     * @return The UI panel to be integrated into the commit dialog
     */
    override fun getBeforeCheckinConfigurationPanel(): RefreshableOnComponent? {
        return CommitMessageConfigPanel()
    }

    /**
     * Private inner class that implements RefreshableOnComponent to provide the commit message
     * configuration panel. This class handles UI component creation and refresh logic for
     * the commit dialog integration.
     */
    private inner class CommitMessageConfigPanel : RefreshableOnComponent {
        private val configPanel: JPanel

        init {
            generateButton = JButton(I18n.t("kilocode:commitMessage.ui.generateButton")).apply {
                addActionListener {
                    generateCommitMessage()
                }
                toolTipText = I18n.t("kilocode:commitMessage.ui.generateButtonTooltip")
            }

            // Create the panel layout
            configPanel = JPanel(BorderLayout()).apply {
                val formBuilder = FormBuilder.createFormBuilder()
                    .addComponent(generateButton)

                add(formBuilder.panel, BorderLayout.CENTER)
            }

            // Check for pending commit message from GitCommitMessageAction
            checkAndSetPendingMessage()
        }

        override fun getComponent(): JPanel = configPanel

        override fun refresh() {
            updateButtonState()
        }

        override fun saveState() {
            // No state to save
        }

        override fun restoreState() {
            // No state to restore
        }
    }

    /**
     * Called before the commit is performed.
     *
     * @return CONTINUE to proceed with commit
     */
    override fun beforeCheckin(): ReturnResult {
        return ReturnResult.COMMIT
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

        // Get workspace path
        val workspacePath = WorkspaceResolver.getWorkspacePathOrShowError(
            project,
            I18n.t("kilocode:commitMessage.error.workspacePathNotFound"),
            I18n.t("kilocode:commitMessage.error.title"),
        ) ?: return

        // Execute commit message generation with progress indication
        isGenerating = true
        updateButtonState()

        ProgressManager.getInstance().run(object : Task.Backgroundable(
            project,
            I18n.t("kilocode:commitMessage.progress.title"),
            true,
        ) {
            override fun run(indicator: ProgressIndicator) {
                indicator.text = I18n.t("kilocode:commitMessage.progress.analyzing")
                indicator.isIndeterminate = true

                try {
                    executeCommitMessageGeneration(project, workspacePath, indicator)
                } catch (e: Exception) {
                    logger.error("Error generating commit message", e)
                    ApplicationManager.getApplication().invokeLater {
                        isGenerating = false
                        updateButtonState()
                        Messages.showErrorDialog(
                            project,
                            I18n.t("kilocode:commitMessage.error.generationFailed", mapOf("error" to (e.message ?: I18n.t("kilocode:commitMessage.error.unknown")))),
                            I18n.t("kilocode:commitMessage.error.title"),
                        )
                    }
                }
            }
        })
    }

    /**
     * Executes the commit message generation with proper EDT handling and timeout protection.
     * Based on patterns from successful plugins like AI Commits.
     *
     * @param project The current project
     * @param workspacePath The absolute path to the Git repository
     * @param indicator Progress indicator for user feedback
     */
    private fun executeCommitMessageGeneration(
        project: Project,
        workspacePath: String,
        indicator: ProgressIndicator,
    ) {
        try {
            indicator.text = I18n.t("kilocode:commitMessage.progress.connecting")
            
            val files = try {
                runBlocking {
                    withTimeout(5000) {
                        getSelectedFiles()
                    }
                }
            } catch (e: TimeoutCancellationException) {
                logger.warn("Timeout getting selected files, using empty list")
                emptyList()
            } catch (e: Exception) {
                logger.warn("Error getting selected files: ${e.message}")
                emptyList()
            }
            
            indicator.text = I18n.t("kilocode:commitMessage.progress.generating")
            
            // Generate message on background thread
            val result = try {
                runBlocking {
                    commitMessageService.generateCommitMessage(project, workspacePath, files)
                }
            } catch (e: Exception) {
                logger.error("Error during message generation", e)
                CommitMessageService.Result.Error(e.message ?: "Unknown error")
            }
                
            // Set message on EDT
            ApplicationManager.getApplication().invokeLater({
                isGenerating = false
                updateButtonState()
                
                when (result) {
                    is CommitMessageService.Result.Success -> {
                        logger.info("Successfully generated and set commit message: ${result.message}")
                        panel.setCommitMessage(result.message)
                    }
                    is CommitMessageService.Result.Error -> {
                        logger.warn("Commit message generation failed: ${result.errorMessage}")
                        Messages.showErrorDialog(
                            project,
                            result.errorMessage,
                            I18n.t("kilocode:commitMessage.error.title"),
                        )
                    }
                }
            }, ModalityState.defaultModalityState())
                
        } catch (e: ProcessCanceledException) {
            logger.info("Commit message generation cancelled")
            ApplicationManager.getApplication().invokeLater({
                isGenerating = false
                updateButtonState()
            }, ModalityState.defaultModalityState())
        } catch (e: Exception) {
            logger.error("Error during commit message generation", e)
            ApplicationManager.getApplication().invokeLater({
                isGenerating = false
                updateButtonState()
                Messages.showErrorDialog(
                    project,
                    I18n.t("kilocode:commitMessage.error.processingFailed", mapOf("error" to (e.message ?: I18n.t("kilocode:commitMessage.error.unknown")))),
                    I18n.t("kilocode:commitMessage.error.title"),
                )
            }, ModalityState.defaultModalityState())
        }
    }

    /**
     * Get selected files using the comprehensive FileDiscoveryService
     */
    private suspend fun getSelectedFiles(): List<String> = withContext(Dispatchers.IO) {
        val dataContext = SimpleDataContext.builder()
            .add(Refreshable.PANEL_KEY, panel)
            .build()
        
        val discoveryResult = fileDiscoveryService.discoverFilesWithResult(panel.project, dataContext)
        when (discoveryResult) {
            is FileDiscoveryService.FileDiscoveryResult.Success -> discoveryResult.files
            is FileDiscoveryService.FileDiscoveryResult.Error -> emptyList()
            FileDiscoveryService.FileDiscoveryResult.NoFiles -> emptyList()
        }
    }

    /**
     * Updates the state of the generate button based on current conditions.
     */
    private fun updateButtonState() {
        generateButton.isEnabled = !isGenerating
    }

    /**
     * Checks for any pending commit message from GitCommitMessageAction and sets it.
     * This allows the action to open the commit dialog with a pre-generated message.
     */
    private fun checkAndSetPendingMessage() {
        try {
            val project = panel.project
            val pendingMessage = project.getUserData(GitCommitMessageAction.PENDING_COMMIT_MESSAGE_KEY)

            if (pendingMessage != null && panel.commitMessage.isNullOrBlank()) {
                logger.info("Found pending commit message, setting it: ${pendingMessage.take(50)}...")
                panel.setCommitMessage(pendingMessage)

                // Clear the pending message so it's not reused
                project.putUserData(GitCommitMessageAction.PENDING_COMMIT_MESSAGE_KEY, null)
            }
        } catch (e: Exception) {
            logger.warn("Error checking for pending commit message", e)
        }
    }
}
