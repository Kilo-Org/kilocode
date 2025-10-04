// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

// kilocode_change - new file
package ai.kilocode.jetbrains.git

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.project.Project
import com.intellij.openapi.actionSystem.DataContext
import com.intellij.openapi.vcs.VcsDataKeys
import com.intellij.openapi.vcs.CheckinProjectPanel
import com.intellij.openapi.vcs.changes.Change
import com.intellij.openapi.vcs.changes.ChangeListManager
import com.intellij.openapi.vcs.changes.ui.ChangesListView
import com.intellij.openapi.vcs.changes.ui.VcsTreeModelData
import com.intellij.openapi.vcs.ui.CommitMessage
import com.intellij.openapi.vcs.ui.Refreshable
import com.intellij.openapi.wm.ToolWindowManager
import com.intellij.vcs.commit.AbstractCommitWorkflowHandler
import com.intellij.vcs.commit.ChangesViewCommitPanel
import java.util.concurrent.CompletableFuture
import java.util.concurrent.TimeUnit

/**
 * Consolidated service for discovering checked/selected files in various JetBrains contexts.
 * Handles the complexity of different UI contexts in a single, well-tested location.
 */
class FileDiscoveryService {
    private val logger: Logger = Logger.getInstance(FileDiscoveryService::class.java)

    /**
     * Discovers files based on current context using multiple fallback strategies.
     */
    fun discoverFiles(project: Project, dataContext: DataContext): FileDiscoveryResult {
        // Strategy 1: Try commit workflow handler (modern workflows)
        tryCommitWorkflowHandler(dataContext)?.let { files ->
            if (files.isNotEmpty()) {
                return FileDiscoveryResult.Success(files, "CommitWorkflowHandler")
            }
        }

        // Strategy 2: Try commit message control context
        tryCommitMessageControl(dataContext)?.let { files ->
            if (files.isNotEmpty()) {
                return FileDiscoveryResult.Success(files, "CommitMessageControl")
            }
        }

        // Strategy 3: Try checkin project panel (legacy support)
        tryCheckinProjectPanel(dataContext)?.let { files ->
            if (files.isNotEmpty()) {
                return FileDiscoveryResult.Success(files, "CheckinProjectPanel")
            }
        }

        // Strategy 4: Try changes list view (non-modal commit window)
        tryChangesListView(dataContext)?.let { files ->
            if (files.isNotEmpty()) {
                return FileDiscoveryResult.Success(files, "ChangesListView")
            }
        }

        // Strategy 5: Try commit tool window
        tryCommitToolWindow(project)?.let { files ->
            if (files.isNotEmpty()) {
                return FileDiscoveryResult.Success(files, "CommitToolWindow")
            }
        }

        // Strategy 6: Get all available changes as fallback
        val allChanges = getAllAvailableChanges(project)
        return if (allChanges.isNotEmpty()) {
            FileDiscoveryResult.Success(allChanges, "AllAvailableChanges")
        } else {
            FileDiscoveryResult.NoFiles
        }
    }

    private fun tryCommitWorkflowHandler(dataContext: DataContext): List<String>? {
        return try {
            val workflowHandler = dataContext.getData(VcsDataKeys.COMMIT_WORKFLOW_HANDLER)
            if (workflowHandler is AbstractCommitWorkflowHandler<*, *>) {
                val changes = workflowHandler.ui.getIncludedChanges()
                changes.mapNotNull { it.virtualFile?.path }
            } else null
        } catch (e: Exception) {
            logger.debug("CommitWorkflowHandler failed: ${e.message}")
            null
        }
    }

    private fun tryCommitMessageControl(dataContext: DataContext): List<String>? {
        return try {
            val commitControl = VcsDataKeys.COMMIT_MESSAGE_CONTROL.getData(dataContext)
            if (commitControl is CommitMessage) {
                val workflowHandlerFromControl = VcsDataKeys.COMMIT_WORKFLOW_HANDLER.getData(dataContext)
                if (workflowHandlerFromControl is AbstractCommitWorkflowHandler<*, *>) {
                    val changes = workflowHandlerFromControl.ui.getIncludedChanges()
                    changes.mapNotNull { it.virtualFile?.path }
                } else null
            } else null
        } catch (e: Exception) {
            logger.debug("CommitMessage control context failed: ${e.message}")
            null
        }
    }

    private fun tryCheckinProjectPanel(dataContext: DataContext): List<String>? {
        return try {
            val refreshable = dataContext.getData(Refreshable.PANEL_KEY)
            if (refreshable is CheckinProjectPanel) {
                val futureResult = CompletableFuture<List<String>>()
                ApplicationManager.getApplication().invokeLater {
                    try {
                        val selectedChanges = refreshable.selectedChanges
                        val paths = selectedChanges.mapNotNull { it.virtualFile?.path }
                        futureResult.complete(paths)
                    } catch (e: Exception) {
                        futureResult.complete(emptyList())
                    }
                }
                futureResult.get(5, TimeUnit.SECONDS)
            } else null
        } catch (e: Exception) {
            logger.debug("CheckinProjectPanel failed: ${e.message}")
            null
        }
    }

    private fun tryChangesListView(dataContext: DataContext): List<String>? {
        return try {
            val changesView = dataContext.getData(ChangesListView.DATA_KEY)
            if (changesView != null) {
                val futureResult = CompletableFuture<List<String>>()
                ApplicationManager.getApplication().invokeLater {
                    try {
                        val includedChanges = VcsTreeModelData.included(changesView)
                            .userObjects(Change::class.java)
                        val paths = includedChanges.mapNotNull { it.virtualFile?.path }
                        futureResult.complete(paths)
                    } catch (e: Exception) {
                        futureResult.complete(emptyList())
                    }
                }
                futureResult.get(5, TimeUnit.SECONDS)
            } else null
        } catch (e: Exception) {
            logger.debug("ChangesListView failed: ${e.message}")
            null
        }
    }

    private fun tryCommitToolWindow(project: Project): List<String>? {
        return try {
            val toolWindow = ToolWindowManager.getInstance(project).getToolWindow("Commit")
                ?: ToolWindowManager.getInstance(project).getToolWindow("Version Control")
                ?: return null

            val content = toolWindow.contentManager.selectedContent ?: return null
            val component = content.component

            when (component) {
                is ChangesViewCommitPanel -> {
                    val futureResult = CompletableFuture<List<String>>()
                    ApplicationManager.getApplication().invokeLater {
                        try {
                            val changes = component.getIncludedChanges()
                            val paths = changes.mapNotNull { it.virtualFile?.path }
                            futureResult.complete(paths)
                        } catch (e: Exception) {
                            logger.debug("Error accessing ChangesViewCommitPanel: ${e.message}")
                            futureResult.complete(emptyList())
                        }
                    }
                    futureResult.get(5, TimeUnit.SECONDS)
                }
                else -> emptyList()
            }
        } catch (e: Exception) {
            logger.debug("CommitToolWindow failed: ${e.message}")
            null
        }
    }

    private fun getAllAvailableChanges(project: Project): List<String> {
        return try {
            val changeListManager = ChangeListManager.getInstance(project)
            val allChanges = mutableSetOf<String>()

            // Get all changes from change lists
            changeListManager.allChanges.forEach { change ->
                change.virtualFile?.path?.let { allChanges.add(it) }
            }

            // Get modified files
            changeListManager.modifiedWithoutEditing.forEach { file ->
                allChanges.add(file.path)
            }

            // Get changes from individual change lists
            changeListManager.changeLists.forEach { changeList ->
                changeList.changes.forEach { change ->
                    change.virtualFile?.path?.let { allChanges.add(it) }
                }
            }

            allChanges.toList()
        } catch (e: Exception) {
            logger.debug("Error getting all changes: ${e.message}")
            emptyList()
        }
    }

    sealed class FileDiscoveryResult {
        data class Success(val files: List<String>, val source: String) : FileDiscoveryResult()
        object NoFiles : FileDiscoveryResult()
    }
}