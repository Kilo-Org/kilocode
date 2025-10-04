// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

package ai.kilocode.jetbrains.git

import com.intellij.openapi.actionSystem.DataContext
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.registry.Registry
import com.intellij.openapi.vcs.CheckinProjectPanel
import com.intellij.openapi.vcs.VcsDataKeys
import com.intellij.openapi.vcs.changes.Change
import com.intellij.openapi.vcs.changes.ui.ChangesListView
import com.intellij.openapi.vcs.changes.ui.VcsTreeModelData
import com.intellij.openapi.vcs.ui.Refreshable
import com.intellij.openapi.wm.ToolWindowManager
import com.intellij.vcs.commit.AbstractCommitWorkflowHandler
import com.intellij.vcs.commit.ChangesViewCommitPanel

/**
 * Utility object to detect and handle different commit UI modes in JetBrains IDEs.
 * Based on research findings about JetBrains architectural evolution since 2019.2.
 */
object CommitModeDetector {
    
    enum class Mode {
        MODAL_DIALOG,      // Classic popup dialog
        NON_MODAL_WINDOW,  // Tool window (default since 2020.1)
        STAGING_AREA       // Git staging workflow
    }
    
    /**
     * Detects current commit mode based on registry settings and available features
     */
    fun getCurrentMode(project: Project): Mode {
        // Check if staging area is enabled
        if (isStagingAreaEnabled()) {
            return Mode.STAGING_AREA
        }
        
        // Check for modal vs non-modal
        return if (isModalCommitEnabled()) {
            Mode.MODAL_DIALOG
        } else {
            Mode.NON_MODAL_WINDOW
        }
    }
    
    private fun isStagingAreaEnabled(): Boolean {
        return try {
            Registry.`is`("git.staging.area.enabled", false)
        } catch (e: Exception) {
            false
        }
    }
    
    private fun isModalCommitEnabled(): Boolean {
        return try {
            // In 2024.1+, modal dialog requires explicit plugin
            Registry.`is`("vcs.commit.modal.dialog", false) ||
            Registry.`is`("vcs.non.modal.commit", false).not()
        } catch (e: Exception) {
            false
        }
    }
    
    /**
     * Get checked files based on current commit mode using comprehensive detection
     */
    fun getCheckedFilesForMode(
        project: Project,
        dataContext: DataContext
    ): List<Change> {
        return when (getCurrentMode(project)) {
            Mode.MODAL_DIALOG -> getFilesFromModalDialog(dataContext)
            Mode.NON_MODAL_WINDOW -> getFilesFromNonModalWindow(project, dataContext)
            Mode.STAGING_AREA -> getFilesFromStagingArea(project, dataContext)
        }
    }
    
    private fun getFilesFromModalDialog(dataContext: DataContext): List<Change> {
        val panel = dataContext.getData(Refreshable.PANEL_KEY) as? CheckinProjectPanel
            ?: return emptyList()
        
        return ApplicationManager.getApplication().runReadAction<List<Change>> {
            try {
                panel.selectedChanges.toList()
            } catch (e: Exception) {
                emptyList()
            }
        }
    }
    
    private fun getFilesFromNonModalWindow(
        project: Project, 
        dataContext: DataContext
    ): List<Change> {
        // Try workflow handler first
        val workflowHandler = dataContext.getData(VcsDataKeys.COMMIT_WORKFLOW_HANDLER)
        if (workflowHandler is AbstractCommitWorkflowHandler<*, *>) {
            return try {
                workflowHandler.ui.getIncludedChanges()
            } catch (e: Exception) {
                emptyList()
            }
        }
        
        // Try tool window
        val toolWindow = ToolWindowManager.getInstance(project).getToolWindow("Commit")
        val content = toolWindow?.contentManager?.selectedContent
        
        if (content?.component is ChangesViewCommitPanel) {
            val panel = content.component as ChangesViewCommitPanel
            return ApplicationManager.getApplication().runReadAction<List<Change>> {
                try {
                    panel.getIncludedChanges()
                } catch (e: Exception) {
                    emptyList<Change>()
                }
            }
        }
        
        // Try changes list view
        val changesView = dataContext.getData(ChangesListView.DATA_KEY)
        if (changesView != null) {
            return ApplicationManager.getApplication().runReadAction<List<Change>> {
                try {
                    VcsTreeModelData.included(changesView).userObjects(Change::class.java)
                } catch (e: Exception) {
                    emptyList<Change>()
                }
            }
        }
        
        return emptyList()
    }
    
    private fun getFilesFromStagingArea(
        project: Project,
        dataContext: DataContext  
    ): List<Change> {
        // Staging area uses different API - for now return empty as fallback
        // This would need Git4Idea specific implementation
        return emptyList()
    }
    
    /**
     * Convert Change objects to file paths safely
     */
    fun changesToPaths(changes: List<Change>): List<String> {
        return changes.mapNotNull { change ->
            change.virtualFile?.path 
                ?: change.beforeRevision?.file?.path 
                ?: change.afterRevision?.file?.path
        }
    }
}