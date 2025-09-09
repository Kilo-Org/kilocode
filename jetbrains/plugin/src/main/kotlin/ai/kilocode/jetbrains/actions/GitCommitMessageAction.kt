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
            I18n.t("tools:commitMessage.actions.description")
        } else {
            I18n.t("tools:commitMessage.actions.descriptionNoChanges")
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
                I18n.t("tools:commitMessage.errors.noChanges"),
                I18n.t("tools:commitMessage.dialogs.info")
            )
            return
        }

        // Get workspace path
        val workspacePath = WorkspaceResolver.getWorkspacePath(project)
        if (workspacePath == null) {
            Messages.showErrorDialog(
                project,
                I18n.t("tools:commitMessage.errors.noWorkspacePath"),
                I18n.t("tools:commitMessage.dialogs.error")
            )
            return
        }

        // Execute commit message generation with progress indication
        ProgressManager.getInstance().run(object : Task.Backgroundable(
            project,
            I18n.t("tools:commitMessage.progress.title"),
            true
        ) {
            override fun run(indicator: ProgressIndicator) {
                indicator.text = I18n.t("tools:commitMessage.progress.analyzing")
                indicator.isIndeterminate = true

                try {
                    generateCommitMessage(project, workspacePath, indicator)
                } catch (e: Exception) {
                    logger.error("Error generating commit message", e)
                    ApplicationManager.getApplication().invokeLater {
                        Messages.showErrorDialog(
                            project,
                            I18n.t("tools:commitMessage.errors.generationFailed", mapOf("error" to (e.message ?: "Unknown error"))),
                            I18n.t("tools:commitMessage.dialogs.error")
                        )
                    }
                }
            }
        })
    }

    /**
     * Generates a commit message using the shared CommitMessageService.
     * The service automatically detects staged changes first, then falls back to unstaged changes.
     *
     * @param project The current project
     * @param workspacePath The absolute path to the Git repository
     * @param indicator Progress indicator for user feedback
     */
    private fun generateCommitMessage(
        project: Project,
        workspacePath: String,
        indicator: ProgressIndicator
    ) {
        indicator.text = I18n.t("tools:commitMessage.progress.connecting")
        
        // Use the shared service for generation
        ApplicationManager.getApplication().executeOnPooledThread {
            try {
                val result = runBlocking {
                    indicator.text = I18n.t("tools:commitMessage.progress.generating")
                    commitMessageService.generateCommitMessage(project, workspacePath)
                }
                
                ApplicationManager.getApplication().invokeLater {
                    when (result) {
                        is CommitMessageService.Result.Success -> {
                            logger.info("Successfully generated commit message: ${result.message}")
                            Messages.showInfoMessage(
                                project,
                                "Generated commit message:\n\n${result.message}",
                                I18n.t("tools:commitMessage.dialogs.success")
                            )
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
                    Messages.showErrorDialog(
                        project,
                        I18n.t("tools:commitMessage.errors.generationFailed", mapOf("error" to (e.message ?: "Unknown error"))),
                        I18n.t("tools:commitMessage.dialogs.error")
                    )
                }
            }
        }
    }

}