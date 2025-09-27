// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

package ai.kilocode.jetbrains.actions

import ai.kilocode.jetbrains.git.CommitMessageService
import ai.kilocode.jetbrains.git.WorkspaceResolver
import ai.kilocode.jetbrains.i18n.I18n
import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.DataContext
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.application.ModalityState
import com.intellij.openapi.application.ReadAction
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.progress.ProgressIndicator
import com.intellij.openapi.progress.ProgressManager
import com.intellij.openapi.progress.Task
import com.intellij.openapi.project.Project
import com.intellij.openapi.ui.Messages
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
import kotlinx.coroutines.runBlocking
import java.util.concurrent.CompletableFuture
import java.util.concurrent.TimeUnit

/**
 * Action that generates AI-powered commit messages for Git repositories.
 * Integrates with JetBrains VCS system to detect changes and uses RPC
 * communication to call the VSCode extension's commit message generation.
 */
class GitCommitMessageAction : AnAction(I18n.t("kilocode:commitMessage.ui.generateButton")) {
    private val logger: Logger = Logger.getInstance(GitCommitMessageAction::class.java)
    private val commitMessageService = CommitMessageService.getInstance()

    override fun getActionUpdateThread(): ActionUpdateThread {
        return ActionUpdateThread.BGT
    }

    /**
     * Updates the action's presentation based on the current project state.
     * The action is enabled when there are any Git changes available.
     * File selection checking is handled during action execution to avoid EDT issues.
     *
     * @param e The action event containing context information
     */
    override fun update(e: AnActionEvent) {
        val project = e.project
        val presentation = e.presentation

        if (project == null) {
            presentation.isEnabled = false
            presentation.description = I18n.t("kilocode:commitMessage.errors.noProject")
            return
        }

        // Simple check for any changes - avoid accessing UI components on BGT
        val changeListManager = ChangeListManager.getInstance(project)
        val hasAnyChanges = changeListManager.allChanges.isNotEmpty()

        presentation.isEnabled = hasAnyChanges
        presentation.description = if (hasAnyChanges) {
            I18n.t("kilocode:commitMessage.ui.generateButtonTooltip")
        } else {
            I18n.t("kilocode:commitMessage.errors.noChanges")
        }
    }

    /**
     * Performs the action when the Generate Commit Message action is triggered.
     * Uses comprehensive multi-context detection to handle both toolbar and dialog invocations.
     *
     * @param e The action event containing context information
     */
    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project
        if (project == null) {
            logger.warn("No project available for commit message generation")
            return
        }

        println("🔧 GitCommitMessageAction.actionPerformed() - KILO LOGO/TOOLBAR BUTTON CLICKED")
        logger.info("Generate Commit Message action triggered")

        val workspacePath = WorkspaceResolver.getWorkspacePathOrShowError(
            project,
            I18n.t("kilocode:commitMessage.errors.noWorkspacePath"),
            I18n.t("kilocode:commitMessage.dialogs.error"),
        ) ?: return

        // Capture dataContext for background use
        val dataContext = e.dataContext

        // Run file detection and processing on background thread to avoid UI freezing
        ApplicationManager.getApplication().executeOnPooledThread {
            try {
                // Try comprehensive file detection using multiple approaches
                val checkedFiles = ApplicationManager.getApplication().runReadAction<List<String>> {
                    getCheckedFilesComprehensive(project, dataContext)
                }
                
                println("🔧 GitCommitMessageAction extracted ${checkedFiles.size} CHECKED files")

                // Check if we're in commit dialog context - must be done on EDT
                ApplicationManager.getApplication().invokeLater {
                    val commitControl = VcsDataKeys.COMMIT_MESSAGE_CONTROL.getData(dataContext)
                    if (commitControl is CommitMessage) {
                        // We're in the commit dialog - generate and set message directly
                        generateAndSetCommitMessage(project, commitControl, checkedFiles, workspacePath)
                    } else {
                        // Toolbar click or no dialog context - use files we found or get all available changes
                        val finalFiles = if (checkedFiles.isEmpty()) {
                            // Try to get from tool window first
                            val toolWindowFiles = getFilesFromCommitToolWindow(project)
                            if (toolWindowFiles.isNotEmpty()) {
                                toolWindowFiles
                            } else {
                                // Get ALL available changes from JetBrains instead of letting TypeScript discover them
                                getAllAvailableChanges(project)
                            }
                        } else {
                            checkedFiles
                        }
                        
                        println("🔧 Using ${finalFiles.size} files for generation: ${finalFiles.take(5).joinToString(", ")}${if (finalFiles.size > 5) "..." else ""}")
                        processWithFiles(project, workspacePath, finalFiles)
                    }
                }
            } catch (ex: Exception) {
                logger.error("Error in background file detection", ex)
                
                // Show error on EDT
                ApplicationManager.getApplication().invokeLater {
                    val message = I18n.t("kilocode:commitMessage.errors.unexpectedError", "details" to ex.localizedMessage)
                    Messages.showErrorDialog(project, message, "Commit Message Generation Error")
                }
            }
        }
    }

    /**
     * Generates and sets commit message directly in the commit dialog.
     * This is called when the button is clicked from within the commit dialog.
     */
    private fun generateAndSetCommitMessage(
        project: Project,
        commitControl: CommitMessage,
        checkedFiles: List<String>,
        workspacePath: String
    ) {
        println("🔧 GitCommitMessageAction.generateAndSetCommitMessage() - COMMIT DIALOG CONTEXT (via VcsDataKeys)")
        
        // Execute commit message generation with progress indication
        ProgressManager.getInstance().run(object : Task.Backgroundable(
            project,
            I18n.t("kilocode:commitMessage.progress.title"),
            true,
        ) {
            override fun run(indicator: ProgressIndicator) {
                indicator.text = I18n.t("kilocode:commitMessage.progress.analyzing")
                indicator.isIndeterminate = true

                try {
                    val result = runBlocking {
                        indicator.text = I18n.t("kilocode:commitMessage.progress.generating")
                        println("🔧 JetBrains Action (COMMIT DIALOG context) using ${checkedFiles.size} checked files: $checkedFiles")
                        
                        // Use the detected files or empty list for all changes
                        commitMessageService.generateCommitMessage(project, workspacePath, checkedFiles)
                    }

                    ApplicationManager.getApplication().invokeLater({
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
                                    I18n.t("kilocode:commitMessage.dialogs.error"),
                                )
                            }
                        }
                    }, ModalityState.defaultModalityState())
                } catch (e: Exception) {
                    logger.error("Error generating commit message", e)
                    ApplicationManager.getApplication().invokeLater({
                        Messages.showErrorDialog(
                            project,
                            I18n.t("kilocode:commitMessage.errors.processingError", mapOf("error" to (e.message ?: I18n.t("kilocode:commitMessage.error.unknown")))),
                            I18n.t("kilocode:commitMessage.dialogs.error"),
                        )
                    }, ModalityState.defaultModalityState())
                }
            }
        })
    }

    /**
     * Process files with commit message generation.
     * This handles both toolbar clicks and cases where files are already detected.
     */
    private fun processWithFiles(project: Project, workspacePath: String, files: List<String>) {
        println("🔧 JetBrains RPC calling with workspace: $workspacePath and ${files.size} files: $files")
        
        ProgressManager.getInstance().run(object : Task.Backgroundable(
            project,
            I18n.t("kilocode:commitMessage.progress.title"),
            true,
        ) {
            override fun run(indicator: ProgressIndicator) {
                indicator.text = I18n.t("kilocode:commitMessage.progress.analyzing")
                indicator.isIndeterminate = true

                try {
                    // Run generation on background thread
                    ApplicationManager.getApplication().executeOnPooledThread {
                        try {
                            val result = runBlocking {
                                indicator.text = I18n.t("kilocode:commitMessage.progress.generating")
                                commitMessageService.generateCommitMessage(project, workspacePath, files.ifEmpty { null })
                            }
                            
                            // Handle result on EDT
                            ApplicationManager.getApplication().invokeLater({
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
                                            I18n.t("kilocode:commitMessage.dialogs.error"),
                                        )
                                    }
                                }
                            }, ModalityState.defaultModalityState())
                        } catch (e: Exception) {
                            logger.error("Error during generation", e)
                            ApplicationManager.getApplication().invokeLater({
                                Messages.showErrorDialog(
                                    project,
                                    I18n.t("kilocode:commitMessage.errors.processingError", mapOf("error" to (e.message ?: I18n.t("kilocode:commitMessage.error.unknown")))),
                                    I18n.t("kilocode:commitMessage.dialogs.error"),
                                )
                            }, ModalityState.defaultModalityState())
                        }
                    }
                } catch (e: Exception) {
                    logger.error("Error starting generation", e)
                    ApplicationManager.getApplication().invokeLater({
                        Messages.showErrorDialog(
                            project,
                            I18n.t("kilocode:commitMessage.errors.processingError", mapOf("error" to (e.message ?: I18n.t("kilocode:commitMessage.error.unknown")))),
                            I18n.t("kilocode:commitMessage.dialogs.error"),
                        )
                    }, ModalityState.defaultModalityState())
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
                    dataContext,
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

    /**
     * Comprehensive method that tries ALL possible ways to get checked files
     * from different JetBrains commit contexts. Based on AI Commits plugin patterns.
     */
    private fun getCheckedFilesComprehensive(
        project: Project,
        dataContext: DataContext
    ): List<String> {
        
        // Method 1: Try CommitWorkflowHandler (works for modern workflows)
        val workflowHandler = dataContext.getData(VcsDataKeys.COMMIT_WORKFLOW_HANDLER)
        if (workflowHandler is AbstractCommitWorkflowHandler<*, *>) {
            try {
                val changes = workflowHandler.ui.getIncludedChanges()
                val paths = changes.mapNotNull { it.virtualFile?.path }
                if (paths.isNotEmpty()) {
                    println("🔧 Got ${paths.size} files via CommitWorkflowHandler")
                    return paths
                }
            } catch (e: Exception) {
                println("🔧 CommitWorkflowHandler failed: ${e.message}")
            }
        }
        
        // Method 2: Try CheckinProjectPanel (legacy support)
        val refreshable = dataContext.getData(Refreshable.PANEL_KEY)
        if (refreshable is CheckinProjectPanel) {
            try {
                // Must be on EDT for this
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
                val paths = futureResult.get(5, TimeUnit.SECONDS) // Wait for EDT operation
                if (paths.isNotEmpty()) {
                    println("🔧 Got ${paths.size} files via CheckinProjectPanel")
                    return paths
                }
            } catch (e: Exception) {
                println("🔧 CheckinProjectPanel failed: ${e.message}")
            }
        }
        
        // Method 3: Try ChangesListView (Non-modal commit window)
        val changesView = dataContext.getData(ChangesListView.DATA_KEY)
        if (changesView != null) {
            try {
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
                val paths = futureResult.get(5, TimeUnit.SECONDS)
                if (paths.isNotEmpty()) {
                    println("🔧 Got ${paths.size} files via ChangesListView")
                    return paths
                }
            } catch (e: Exception) {
                println("🔧 ChangesListView failed: ${e.message}")
            }
        }
        
        // Method 4: Try to get from the commit message control
        val commitControl = VcsDataKeys.COMMIT_MESSAGE_CONTROL.getData(dataContext)
        if (commitControl is CommitMessage) {
            // We're in commit dialog context
            val workflowHandlerFromControl = VcsDataKeys.COMMIT_WORKFLOW_HANDLER.getData(dataContext)
            if (workflowHandlerFromControl is AbstractCommitWorkflowHandler<*, *>) {
                try {
                    val changes = workflowHandlerFromControl.ui.getIncludedChanges()
                    val paths = changes.mapNotNull { it.virtualFile?.path }
                    if (paths.isNotEmpty()) {
                        println("🔧 Got ${paths.size} files via CommitMessage control context")
                        return paths
                    }
                } catch (e: Exception) {
                    println("🔧 CommitMessage control context failed: ${e.message}")
                }
            }
        }
        
        return emptyList()
    }

    /**
     * Try to get files from the commit tool window when toolbar is clicked
     */
    private fun getFilesFromCommitToolWindow(project: Project): List<String> {
        val toolWindow = ToolWindowManager.getInstance(project).getToolWindow("Commit")
            ?: ToolWindowManager.getInstance(project).getToolWindow("Version Control")
            ?: return emptyList()
        
        val content = toolWindow.contentManager.selectedContent ?: return emptyList()
        val component = content.component
        
        // Handle different commit panel types
        return when (component) {
            is ChangesViewCommitPanel -> {
                val futureResult = CompletableFuture<List<String>>()
                ApplicationManager.getApplication().invokeLater {
                    try {
                        val changes = component.getIncludedChanges()
                        val paths = changes.mapNotNull { it.virtualFile?.path }
                        futureResult.complete(paths)
                    } catch (e: Exception) {
                        println("🔧 Error accessing ChangesViewCommitPanel: ${e.message}")
                        futureResult.complete(emptyList())
                    }
                }
                try {
                    futureResult.get(5, TimeUnit.SECONDS)
                } catch (e: Exception) {
                    emptyList()
                }
            }
            else -> {
                // Try to find commit panel in component hierarchy
                emptyList()
            }
        }
    }

    /**
     * Get ALL available changes that JetBrains knows about.
     * This ensures we get the same files that JetBrains UI shows, rather than
     * relying on TypeScript-side git discovery.
     */
    private fun getAllAvailableChanges(project: Project): List<String> {
        println("🔧 Getting ALL available changes from JetBrains ChangeListManager")
        
        val changeListManager = ChangeListManager.getInstance(project)
        val allChanges = mutableListOf<String>()
        
        try {
            // Get all changes from all change lists (this includes staged, unstaged, and modified files)
            for (change in changeListManager.allChanges) {
                change.virtualFile?.path?.let { path ->
                    allChanges.add(path)
                }
            }
            
            // Get modified files that might not be in changes yet
            for (file in changeListManager.modifiedWithoutEditing) {
                val path = file.path
                if (!allChanges.contains(path)) {
                    allChanges.add(path)
                }
            }
            
            // Try to get unversioned files from different change lists
            for (changeList in changeListManager.changeLists) {
                for (change in changeList.changes) {
                    change.virtualFile?.path?.let { path ->
                        if (!allChanges.contains(path)) {
                            allChanges.add(path)
                        }
                    }
                }
            }
            
            println("🔧 Found ${allChanges.size} total changes: ${allChanges.take(3).joinToString(", ")}${if (allChanges.size > 3) "..." else ""}")
            return allChanges.distinct()
            
        } catch (e: Exception) {
            println("🔧 Error getting all changes: ${e.message}")
            // If all else fails, fall back to empty list - the TypeScript side can handle discovery
            return emptyList()
        }
    }

    companion object {
        val PENDING_COMMIT_MESSAGE_KEY = com.intellij.openapi.util.Key.create<String>("KILOCODE_PENDING_COMMIT_MESSAGE")
    }
}
