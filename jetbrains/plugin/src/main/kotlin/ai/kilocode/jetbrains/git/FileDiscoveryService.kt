package ai.kilocode.jetbrains.git

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.progress.util.BackgroundTaskUtil
import com.intellij.openapi.project.Project
import com.intellij.openapi.actionSystem.DataContext
import com.intellij.openapi.vcs.VcsDataKeys
import com.intellij.openapi.vcs.CheckinProjectPanel
import com.intellij.openapi.vcs.changes.Change
import com.intellij.openapi.vcs.changes.ChangeListManager
import com.intellij.vcs.commit.CommitMessageUi
import com.intellij.openapi.vcs.ui.Refreshable
import com.intellij.openapi.wm.ToolWindowManager
import java.util.concurrent.CompletableFuture
import java.util.concurrent.TimeUnit

/**
 * Service for discovering files to include in commit messages
 */
class FileDiscoveryService {
    private val logger: Logger = Logger.getInstance(FileDiscoveryService::class.java)

    /**
     * Discover files from the given data context using multiple strategies
     */
    fun discoverFiles(project: Project, dataContext: DataContext): List<String> {
        logger.debug("Attempting to discover files from DataContext")
        
        // Try different strategies in order of preference
        return tryCommitMessageControl(project, dataContext)
            ?: tryCommitToolWindow(project)
            ?: tryChangeListManager(project)
            ?: emptyList()
    }

    private fun tryCommitMessageControl(project: Project, dataContext: DataContext): List<String>? {
        return try {
            val commitControl = VcsDataKeys.COMMIT_MESSAGE_CONTROL.getData(dataContext)
            if (commitControl is CommitMessageUi) {
                // Fallback to change list manager when we have a commit control
                val changeListManager = ChangeListManager.getInstance(project)
                val changes = changeListManager.defaultChangeList.changes
                changes.mapNotNull { it.virtualFile?.path }
            } else null
        } catch (e: Exception) {
            logger.debug("CommitMessage control context failed: ${e.message}")
            null
        }
    }

    private fun tryCommitToolWindow(project: Project): List<String>? {
        return try {
            val toolWindow = ToolWindowManager.getInstance(project).getToolWindow("Commit")
                ?: ToolWindowManager.getInstance(project).getToolWindow("Version Control")
                ?: return null

            // Fallback to change list manager
            val changeListManager = ChangeListManager.getInstance(project)
            val changes = changeListManager.defaultChangeList.changes
            changes.mapNotNull { it.virtualFile?.path }
        } catch (e: Exception) {
            logger.debug("CommitToolWindow failed: ${e.message}")
            null
        }
    }

    private fun tryChangeListManager(project: Project): List<String>? {
        return try {
            val changeListManager = ChangeListManager.getInstance(project)
            val changes = changeListManager.defaultChangeList.changes
            changes.mapNotNull { it.virtualFile?.path }
        } catch (e: Exception) {
            logger.debug("ChangeListManager failed: ${e.message}")
            null
        }
    }

    /**
     * Result of file discovery operation
     */
    sealed class FileDiscoveryResult {
        data class Success(val files: List<String>) : FileDiscoveryResult()
        data class Error(val message: String) : FileDiscoveryResult()
        object NoFiles : FileDiscoveryResult()
    }

    /**
     * Enhanced discovery with result wrapper
     */
    fun discoverFilesWithResult(project: Project, dataContext: DataContext): FileDiscoveryResult {
        return try {
            val files = discoverFiles(project, dataContext)
            when {
                files.isNotEmpty() -> FileDiscoveryResult.Success(files)
                else -> FileDiscoveryResult.NoFiles
            }
        } catch (e: Exception) {
            logger.warn("File discovery failed", e)
            FileDiscoveryResult.Error("Failed to discover files: ${e.message}")
        }
    }

    companion object {
        @JvmStatic
        fun getInstance(): FileDiscoveryService {
            return ApplicationManager.getApplication().getService(FileDiscoveryService::class.java)
        }
    }
}