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
import com.intellij.openapi.vcs.checkin.CheckinHandler.ReturnResult
import com.intellij.openapi.vcs.ui.RefreshableOnComponent
import com.intellij.ui.components.JBCheckBox
import com.intellij.util.ui.FormBuilder
import ai.kilocode.jetbrains.git.WorkspaceResolver
import ai.kilocode.jetbrains.i18n.I18n
import java.awt.BorderLayout
import kotlinx.coroutines.runBlocking
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
    private val commitMessageService = CommitMessageService.getInstance()
    
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
            generateButton = JButton(I18n.t("kilocode:commitMessage.ui.generateButton")).apply {
                addActionListener { generateCommitMessage() }
                toolTipText = I18n.t("kilocode:commitMessage.ui.generateButtonTooltip")
            }

            autoGenerateCheckBox = JBCheckBox(I18n.t("kilocode:commitMessage.ui.autoGenerateCheckbox"), false).apply {
                toolTipText = I18n.t("kilocode:commitMessage.ui.autoGenerateTooltip")
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
        
        // Check if there are changes to commit
        if (panel.selectedChanges.isEmpty()) {
            Messages.showInfoMessage(
                project,
                I18n.t("kilocode:commitMessage.noChanges"),
                I18n.t("kilocode:commitMessage.dialogs.title")
            )
            return
        }
        
        // Get workspace path
        val workspacePath = WorkspaceResolver.getWorkspacePath(project)
        if (workspacePath == null) {
            Messages.showErrorDialog(
                project,
                I18n.t("kilocode:commitMessage.errors.workspaceNotFound"),
                I18n.t("kilocode:commitMessage.dialogs.error")
            )
            return
        }
        
        // Execute commit message generation with progress indication
        isGenerating = true
        updateButtonState()
        
        ProgressManager.getInstance().run(object : Task.Backgroundable(
            project,
            I18n.t("kilocode:commitMessage.generating"),
            true
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
                            I18n.t("kilocode:commitMessage.generationFailed", mapOf("errorMessage" to (e.message ?: "Unknown error"))),
                            I18n.t("kilocode:commitMessage.dialogs.error")
                        )
                    }
                }
            }
        })
    }

    /**
     * Executes the commit message generation using the shared CommitMessageService.
     * The service automatically detects staged changes first, then falls back to unstaged changes.
     *
     * @param project The current project
     * @param workspacePath The absolute path to the Git repository
     * @param indicator Progress indicator for user feedback
     */
    private fun executeCommitMessageGeneration(
        project: Project,
        workspacePath: String,
        indicator: ProgressIndicator
    ) {
        indicator.text = I18n.t("kilocode:commitMessage.progress.connecting")
        
        // Use the shared service for generation
        ApplicationManager.getApplication().executeOnPooledThread {
            try {
                val result = runBlocking {
                    indicator.text = I18n.t("kilocode:commitMessage.generating")
                    commitMessageService.generateCommitMessage(project, workspacePath)
                }
                
                ApplicationManager.getApplication().invokeLater {
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
                                I18n.t("tools:commitMessage.dialogs.error")
                            )
                        }
                    }
                }
            } catch (e: Exception) {
                logger.error("Error during commit message generation", e)
                ApplicationManager.getApplication().invokeLater {
                    isGenerating = false
                    updateButtonState()
                    Messages.showErrorDialog(
                        project,
                        I18n.t("tools:commitMessage.errors.processingError", mapOf("error" to (e.message ?: "Unknown error"))),
                        I18n.t("tools:commitMessage.dialogs.error")
                    )
                }
            }
        }
    }

    /**
     * Updates the state of the generate button based on current conditions.
     */
    private fun updateButtonState() {
        generateButton.isEnabled = !isGenerating && panel.selectedChanges.isNotEmpty()
        generateButton.text = if (isGenerating) {
            I18n.t("kilocode:commitMessage.ui.generatingButton")
        } else {
            I18n.t("kilocode:commitMessage.ui.generateButton")
        }
    }

}