package ai.kilocode.jetbrains.git

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.project.Project
import com.intellij.openapi.actionSystem.DataContext
import com.intellij.openapi.vcs.VcsDataKeys
import com.intellij.openapi.vcs.CheckinProjectPanel
import com.intellij.openapi.vcs.changes.Change
import com.intellij.openapi.vcs.changes.ChangeListManager
import com.intellij.openapi.vcs.ui.Refreshable
import com.intellij.openapi.wm.ToolWindowManager

/**
 * Service for discovering files to include in commit messages
 */
class FileDiscoveryService {
    private val logger: Logger = Logger.getInstance(FileDiscoveryService::class.java)

    /**
     * Discover files from the given data context using multiple strategies
     */
    fun discoverFiles(project: Project, dataContext: DataContext): List<String> {
        logger.info("Starting file discovery for commit message generation")
        
        // Try different strategies in order of preference
        // 1. VcsDataKeys (contextual selection) - most specific
        // 2. CheckinProjectPanel (from commit dialog)
        // 3. ChangeListManager (fallback to all uncommitted changes)
        
        val result = tryVcsDataKeys(dataContext)
            ?: tryCheckinProjectPanel(dataContext)
            ?: tryChangeListManager(project)
            ?: emptyList()
        
        logger.info("File discovery completed: found ${result.size} files")
        return result
    }

    private fun tryVcsDataKeys(dataContext: DataContext): List<String>? {
        return try {
            logger.debug("[DIAGNOSTIC] Trying VcsDataKeys discovery...")
            
            // Try SELECTED_CHANGES first (user selection)
            val selectedChanges = VcsDataKeys.SELECTED_CHANGES.getData(dataContext)
            logger.debug("VcsDataKeys.SELECTED_CHANGES.getData() returned: ${selectedChanges?.size ?: "null"} changes")
            if (!selectedChanges.isNullOrEmpty()) {
                val files = selectedChanges.mapNotNull { it.virtualFile?.path }
                logger.debug("Mapped SELECTED_CHANGES to ${files.size} files")
                if (files.isNotEmpty()) {
                    return files
                }
            }

            // Try CHANGES (context changes)
            val changes = VcsDataKeys.CHANGES.getData(dataContext)
            logger.debug("VcsDataKeys.CHANGES.getData() returned: ${changes?.size ?: "null"} changes")
            if (!changes.isNullOrEmpty()) {
                val files = changes.mapNotNull { it.virtualFile?.path }
                logger.debug("Mapped CHANGES to ${files.size} files")
                if (files.isNotEmpty()) {
                    return files
                }
            }
            
            logger.debug("[DIAGNOSTIC] VcsDataKeys: no changes found from either SELECTED_CHANGES or CHANGES")
            null
        } catch (e: Exception) {
            logger.warn("[DIAGNOSTIC] VcsDataKeys discovery failed with exception: ${e.message}", e)
            null
        }
    }

    private fun tryCheckinProjectPanel(dataContext: DataContext): List<String>? {
        return try {
            logger.debug("[DIAGNOSTIC] Trying CheckinProjectPanel discovery...")
            
            // Try to get the panel from DataContext
            val panel = Refreshable.PANEL_KEY.getData(dataContext) as? CheckinProjectPanel
            logger.debug("Refreshable.PANEL_KEY.getData() returned: ${panel?.let { it::class.java.simpleName } ?: "null"}")
            if (panel != null) {
                logger.debug("[DIAGNOSTIC] Found CheckinProjectPanel")
                
                // Try to get selected changes
                val selectedChanges = try {
                    panel.selectedChanges
                } catch (e: Exception) {
                    logger.warn("[DIAGNOSTIC] Failed to get selectedChanges from CheckinProjectPanel with exception: ${e.message}", e)
                    null
                }
                logger.debug("CheckinProjectPanel.selectedChanges returned: ${selectedChanges?.size ?: "null"} changes")
                
                if (!selectedChanges.isNullOrEmpty()) {
                    val files = selectedChanges.mapNotNull { it.virtualFile?.path }
                    logger.debug("Mapped CheckinProjectPanel.selectedChanges to ${files.size} files")
                    if (files.isNotEmpty()) {
                        return files
                    }
                }
                
                logger.debug("[DIAGNOSTIC] CheckinProjectPanel exists but no selected changes found")
            } else {
                logger.debug("[DIAGNOSTIC] No CheckinProjectPanel in DataContext")
            }
            null
        } catch (e: Exception) {
            logger.warn("[DIAGNOSTIC] CheckinProjectPanel discovery failed with exception: ${e.message}", e)
            null
        }
    }

    private fun tryChangeListManager(project: Project): List<String>? {
        return try {
            logger.debug("[DIAGNOSTIC] Trying ChangeListManager discovery (fallback)...")
            
            val changeListManager = ChangeListManager.getInstance(project)
            logger.debug("Retrieved ChangeListManager instance")
            
            // Get all changes from all changelists
            val allChanges = changeListManager.allChanges
            logger.debug("ChangeListManager.allChanges returned: ${allChanges.size} changes")
            if (allChanges.isNotEmpty()) {
                val files = allChanges.mapNotNull { it.virtualFile?.path }
                logger.debug("Mapped ChangeListManager.allChanges to ${files.size} files")
                return files
            }
            
            logger.warn("[DIAGNOSTIC] ChangeListManager: no changes found in any changelist")
            null
        } catch (e: Exception) {
            logger.error("[DIAGNOSTIC] ChangeListManager discovery failed with exception: ${e.message}", e)
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
                else -> {
                    logger.warn("No files discovered from any source")
                    FileDiscoveryResult.NoFiles
                }
            }
        } catch (e: Exception) {
            logger.error("File discovery failed with exception", e)
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