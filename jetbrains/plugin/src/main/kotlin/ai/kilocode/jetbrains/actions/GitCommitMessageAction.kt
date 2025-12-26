// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

// kilocode_change - new file
package ai.kilocode.jetbrains.actions

import ai.kilocode.jetbrains.git.CommitMessageService
import ai.kilocode.jetbrains.git.WorkspaceResolver
import ai.kilocode.jetbrains.git.FileDiscoveryService
import ai.kilocode.jetbrains.i18n.I18n
import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.DataContext
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.progress.ProgressIndicator
import com.intellij.openapi.progress.ProgressManager
import com.intellij.openapi.progress.Task
import com.intellij.openapi.project.Project
import com.intellij.openapi.ui.Messages
import com.intellij.openapi.vcs.VcsDataKeys
import com.intellij.openapi.vcs.changes.ChangeListManager
import com.intellij.vcs.commit.CommitMessageUi
import kotlinx.coroutines.runBlocking

class GitCommitMessageAction : AnAction(I18n.t("kilocode:commitMessage.ui.generateButton")) {
    private val logger: Logger = Logger.getInstance(GitCommitMessageAction::class.java)
    private val fileDiscoveryService = FileDiscoveryService()

    override fun getActionUpdateThread(): ActionUpdateThread {
        return ActionUpdateThread.BGT
    }

    override fun update(e: AnActionEvent) {
        val project = e.project
        val presentation = e.presentation

        if (project == null) {
            presentation.isEnabled = false
            presentation.description = I18n.t("kilocode:commitMessage.errors.noProject")
            return
        }

        val changeListManager = ChangeListManager.getInstance(project)
        val hasAnyChanges = changeListManager.allChanges.isNotEmpty()

        presentation.isEnabled = hasAnyChanges
        presentation.description = if (hasAnyChanges) {
            I18n.t("kilocode:commitMessage.ui.generateButtonTooltip")
        } else {
            I18n.t("kilocode:commitMessage.errors.noChanges")
        }
    }

    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project
        if (project == null) {
            logger.warn("No project available for commit message generation")
            return
        }

        val workspacePath = WorkspaceResolver.getWorkspacePathOrShowError(
            project,
            I18n.t("kilocode:commitMessage.errors.noWorkspacePath"),
            I18n.t("kilocode:commitMessage.dialogs.error"),
        ) ?: return

        val dataContext = e.dataContext
        val commitControl = VcsDataKeys.COMMIT_MESSAGE_CONTROL.getData(dataContext)

        when {
            commitControl is CommitMessageUi -> {
                generateAndSetCommitMessage(project, commitControl, workspacePath, dataContext)
            }
            else -> {
                generateAndOpenCommitDialog(project, workspacePath, dataContext)
            }
        }
    }

    private fun generateAndSetCommitMessage(
        project: Project,
        commitControl: CommitMessageUi,
        workspacePath: String,
        dataContext: DataContext
    ) {
        ProgressManager.getInstance().run(object : Task.Backgroundable(
            project,
            I18n.t("kilocode:commitMessage.progress.title"),
            true,
        ) {
            override fun run(indicator: ProgressIndicator) {
                indicator.text = I18n.t("kilocode:commitMessage.progress.analyzing")
                indicator.isIndeterminate = true

                try {
                    val discoveryResult = fileDiscoveryService.discoverFilesWithResult(project, dataContext)
                    val files = when (discoveryResult) {
                        is FileDiscoveryService.FileDiscoveryResult.Success -> discoveryResult.files
                        is FileDiscoveryService.FileDiscoveryResult.Error -> emptyList()
                        FileDiscoveryService.FileDiscoveryResult.NoFiles -> emptyList()
                    }

                    indicator.text = I18n.t("kilocode:commitMessage.progress.generating")
                    val result = runBlocking {
                        CommitMessageService.getInstance(project).generateCommitMessage(project, workspacePath, files.ifEmpty { null })
                    }

                    ApplicationManager.getApplication().invokeLater {
                        when (result) {
                            is CommitMessageService.Result.Success -> {
                                commitControl.text = result.message
                            }
                            is CommitMessageService.Result.Error -> {
                                Messages.showErrorDialog(
                                    project,
                                    result.errorMessage,
                                    I18n.t("kilocode:commitMessage.dialogs.error"),
                                )
                            }
                        }
                    }
                } catch (e: Exception) {
                    logger.error("Error generating commit message", e)
                    ApplicationManager.getApplication().invokeLater {
                        Messages.showErrorDialog(
                            project,
                            I18n.t("kilocode:commitMessage.errors.processingError",
                                mapOf("error" to (e.message ?: I18n.t("kilocode:commitMessage.error.unknown")))),
                            I18n.t("kilocode:commitMessage.dialogs.error"),
                        )
                    }
                }
            }
        })
    }

    private fun generateAndOpenCommitDialog(project: Project, workspacePath: String, dataContext: DataContext) {
        ProgressManager.getInstance().run(object : Task.Backgroundable(
            project,
            I18n.t("kilocode:commitMessage.progress.title"),
            true,
        ) {
            override fun run(indicator: ProgressIndicator) {
                indicator.text = I18n.t("kilocode:commitMessage.progress.analyzing")
                indicator.isIndeterminate = true

                try {
                    val discoveryResult = fileDiscoveryService.discoverFilesWithResult(project, dataContext)
                    val files = when (discoveryResult) {
                        is FileDiscoveryService.FileDiscoveryResult.Success -> discoveryResult.files
                        is FileDiscoveryService.FileDiscoveryResult.Error -> emptyList()
                        FileDiscoveryService.FileDiscoveryResult.NoFiles -> emptyList()
                    }

                    indicator.text = I18n.t("kilocode:commitMessage.progress.generating")
                    val result = runBlocking {
                        CommitMessageService.getInstance(project).generateCommitMessage(project, workspacePath, files.ifEmpty { null })
                    }

                    ApplicationManager.getApplication().invokeLater {
                        when (result) {
                            is CommitMessageService.Result.Success -> {
                                openCommitDialogWithMessage(project, result.message)
                            }
                            is CommitMessageService.Result.Error -> {
                                Messages.showErrorDialog(
                                    project,
                                    result.errorMessage,
                                    I18n.t("kilocode:commitMessage.dialogs.error"),
                                )
                            }
                        }
                    }
                } catch (e: Exception) {
                    logger.error("Error generating commit message", e)
                    ApplicationManager.getApplication().invokeLater {
                        Messages.showErrorDialog(
                            project,
                            I18n.t("kilocode:commitMessage.errors.processingError",
                                mapOf("error" to (e.message ?: I18n.t("kilocode:commitMessage.error.unknown")))),
                            I18n.t("kilocode:commitMessage.dialogs.error"),
                        )
                    }
                }
            }
        })
    }

    private fun openCommitDialogWithMessage(project: Project, message: String) {
        try {
            val actionManager = com.intellij.openapi.actionSystem.ActionManager.getInstance()
            val commitAction = actionManager.getAction("CheckinProject")

            if (commitAction != null) {
                project.putUserData(PENDING_COMMIT_MESSAGE_KEY, message)
                val dataContext = com.intellij.openapi.actionSystem.impl.SimpleDataContext.getProjectContext(project)
                val actionEvent = com.intellij.openapi.actionSystem.AnActionEvent.createFromDataContext(
                    "GitCommitMessageAction",
                    null,
                    dataContext,
                )
                commitAction.actionPerformed(actionEvent)
            }
        } catch (e: Exception) {
            logger.error("Failed to open commit dialog", e)
        }
    }


    companion object {
        val PENDING_COMMIT_MESSAGE_KEY = com.intellij.openapi.util.Key.create<String>("KILOCODE_PENDING_COMMIT_MESSAGE")
    }
}
