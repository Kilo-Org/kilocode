// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

package ai.kilocode.jetbrains.actions

import com.intellij.openapi.actionSystem.ActionUpdateThread
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
import com.intellij.openapi.vcs.VcsDataKeys
import com.intellij.openapi.vcs.ui.CommitMessage
import com.intellij.openapi.vfs.VirtualFileManager
import ai.kilocode.jetbrains.git.WorkspaceResolver
import ai.kilocode.jetbrains.git.CommitMessageService
import ai.kilocode.jetbrains.i18n.I18n
import kotlinx.coroutines.runBlocking

/**
 * Action that generates AI-powered commit messages for Git repositories.
 * Integrates with JetBrains VCS system to detect changes and uses RPC
 * communication to call the VSCode extension's commit message generation.
 */
class GitCommitMessageAction : AnAction("Generate Commit Message") {
    private val logger: Logger = Logger.getInstance(GitCommitMessageAction::class.java)
    private val commitMessageService = CommitMessageService.getInstance()

    override fun getActionUpdateThread(): ActionUpdateThread {
        return ActionUpdateThread.BGT
    }

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
            "Generate AI-powered commit message from code changes"
        } else {
            "No changes available to analyze"
        }
    }

    /**
     * Performs the action when the Generate Commit Message action is triggered.
     * Detects Git changes, calls the VSCode extension via RPC, and sets the message directly.
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

        // First, try to get the commit message control directly from the action context
        val commitControl = VcsDataKeys.COMMIT_MESSAGE_CONTROL.getData(e.dataContext)
        
        if (commitControl is CommitMessage) {
            // We're in the commit dialog - generate and set message directly
            generateAndSetCommitMessage(project, commitControl)
            return
        }

        val workspacePath = WorkspaceResolver.getWorkspacePathOrShowError(
            project,
            I18n.t("kilocode:commitMessage.errors.noWorkspacePath"),
            I18n.t("kilocode:commitMessage.dialogs.error")
        ) ?: return
        
        openCommitDialogWithGeneratedMessage(project, workspacePath)
    }

    /**
     * Generates and sets commit message directly in the commit dialog.
     * This is called when the button is clicked from within the commit dialog.
     */
    private fun generateAndSetCommitMessage(
        project: Project,
        commitControl: CommitMessage
    ) {
        val workspacePath = WorkspaceResolver.getWorkspacePathOrShowError(
            project,
            I18n.t("kilocode:commitMessage.errors.noWorkspacePath"),
            I18n.t("kilocode:commitMessage.dialogs.error")
        ) ?: return

        // Execute commit message generation with progress indication
        ProgressManager.getInstance().run(object : Task.Backgroundable(
            project,
            I18n.t("kilocode:commitMessage.progress.title"),
            true
        ) {
            override fun run(indicator: ProgressIndicator) {
                indicator.text = I18n.t("kilocode:commitMessage.progress.analyzing")
                indicator.isIndeterminate = true

                try {
                    val result = runBlocking {
                        indicator.text = I18n.t("kilocode:commitMessage.progress.generating")
                        commitMessageService.generateCommitMessage(project, workspacePath)
                    }
                    
                    ApplicationManager.getApplication().invokeLater {
                        when (result) {
                            is CommitMessageService.Result.Success -> {
                                logger.info("Successfully generated and set commit message: ${result.message}")
                                commitControl.setCommitMessage(result.message)
                            }
                            is CommitMessageService.Result.Error -> {
                                logger.warn("Commit message generation failed: ${result.errorMessage}")
                                Messages.showErrorDialog(
                                    project,
                                    result.errorMessage,
                                    I18n.t("kilocode:commitMessage.dialogs.error")
                                )
                            }
                        }
                    }
                } catch (e: Exception) {
                    logger.error("Error generating commit message", e)
                    ApplicationManager.getApplication().invokeLater {
                        Messages.showErrorDialog(
                            project,
                            I18n.t("kilocode:commitMessage.errors.processingError", mapOf("error" to (e.message ?: "Unknown error"))),
                            I18n.t("kilocode:commitMessage.dialogs.error")
                        )
                    }
                }
            }
        })
    }

    /**
     * Opens the commit dialog and generates message to populate it.
     * This is called when the button is clicked outside the commit dialog.
     */
    private fun openCommitDialogWithGeneratedMessage(project: Project, workspacePath: String) {
        ProgressManager.getInstance().run(object : Task.Backgroundable(
            project,
            I18n.t("kilocode:commitMessage.progress.title"),
            true
        ) {
            override fun run(indicator: ProgressIndicator) {
                indicator.text = I18n.t("kilocode:commitMessage.progress.analyzing")
                indicator.isIndeterminate = true

                try {
                    val result = runBlocking {
                        indicator.text = I18n.t("kilocode:commitMessage.progress.generating")
                        commitMessageService.generateCommitMessage(project, workspacePath)
                    }
                    
                    ApplicationManager.getApplication().invokeLater {
                        when (result) {
                            is CommitMessageService.Result.Success -> {
                                logger.info("Successfully generated commit message, opening dialog: ${result.message}")
                                openCommitDialogWithMessage(project, result.message)
                            }
                            is CommitMessageService.Result.Error -> {
                                logger.warn("Commit message generation failed: ${result.errorMessage}")
                                Messages.showErrorDialog(
                                    project,
                                    result.errorMessage,
                                    I18n.t("kilocode:commitMessage.dialogs.error")
                                )
                            }
                        }
                    }
                } catch (e: Exception) {
                    logger.error("Error generating commit message", e)
                    ApplicationManager.getApplication().invokeLater {
                        Messages.showErrorDialog(
                            project,
                            I18n.t("kilocode:commitMessage.errors.processingError", mapOf("error" to (e.message ?: "Unknown error"))),
                            I18n.t("kilocode:commitMessage.dialogs.error")
                        )
                    }
                }
            }
        })
    }

    /**
     * Opens the commit dialog with the pre-generated message.
     */
    private fun openCommitDialogWithMessage(project: Project, message: String) {
        try {
            // Use ActionManager to trigger the commit action
            val actionManager = com.intellij.openapi.actionSystem.ActionManager.getInstance()
            val commitAction = actionManager.getAction("CheckinProject")
            
            if (commitAction != null) {
                // Store the message to be set when the dialog opens
                project.putUserData(PENDING_COMMIT_MESSAGE_KEY, message)
                
                // Create action event and trigger commit dialog
                val dataContext = com.intellij.openapi.actionSystem.impl.SimpleDataContext.getProjectContext(project)
                val actionEvent = com.intellij.openapi.actionSystem.AnActionEvent.createFromDataContext(
                    "GitCommitMessageAction",
                    null,
                    dataContext
                )
                
                commitAction.actionPerformed(actionEvent)
                logger.info("Opened commit dialog, message will be set by handler")
            } else {
                logger.error("CheckinProject action not found - commit message generation failed")
            }
        } catch (e: Exception) {
            logger.error("Failed to open commit dialog - commit message generation failed", e)
        }
    }

    companion object {
        val PENDING_COMMIT_MESSAGE_KEY = com.intellij.openapi.util.Key.create<String>("KILOCODE_PENDING_COMMIT_MESSAGE")
    }
}