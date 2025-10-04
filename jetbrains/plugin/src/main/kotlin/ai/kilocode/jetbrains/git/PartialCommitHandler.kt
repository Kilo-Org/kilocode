// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

package ai.kilocode.jetbrains.git

import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.project.Project
import com.intellij.openapi.vcs.changes.Change
import com.intellij.openapi.vcs.changes.ChangeListChange
import com.intellij.openapi.vcs.ex.PartialLocalLineStatusTracker
import com.intellij.openapi.vcs.impl.PartialChangesUtil

/**
 * Handler for partial file commits in JetBrains IDEs.
 * Supports detection and content extraction for partial commits (IntelliJ 2020.3+).
 * Based on research findings about partial commit APIs.
 */
object PartialCommitHandler {
    
    private val logger = Logger.getInstance(PartialCommitHandler::class.java)
    
    data class FileContent(
        val path: String,
        val content: String,
        val isPartial: Boolean
    )
    
    /**
     * Get content that will actually be committed (handles partial commits)
     */
    fun getCommittedContent(
        project: Project,
        change: Change
    ): FileContent? {
        val file = change.virtualFile ?: return null
        
        try {
            // Check if this is a partial commit - simplified approach
            val isPartial = try {
                if (change is ChangeListChange) {
                    val tracker = PartialChangesUtil.getPartialTracker(project, change)
                    tracker != null && tracker.hasPartialChangesToCommit()
                } else {
                    false
                }
            } catch (e: Exception) {
                logger.debug("Error checking partial commit status: ${e.message}")
                false
            }
            
            if (isPartial && change is ChangeListChange) {
                // For partial commits, we still get the full content but mark it as partial
                // Advanced partial content extraction would require version-specific API handling
                val partialContent = getPartialContent(PartialChangesUtil.getPartialTracker(project, change)!!, change)
                return FileContent(
                    path = file.path,
                    content = partialContent,
                    isPartial = true
                )
            }
            
            // Full file commit
            return FileContent(
                path = file.path,
                content = file.contentsToByteArray().toString(Charsets.UTF_8),
                isPartial = false
            )
        } catch (e: Exception) {
            logger.warn("Failed to get committed content for ${file.path}: ${e.message}")
            // Fallback to full file content
            return try {
                FileContent(
                    path = file.path,
                    content = file.contentsToByteArray().toString(Charsets.UTF_8),
                    isPartial = false
                )
            } catch (fallbackException: Exception) {
                logger.error("Failed to get fallback content for ${file.path}", fallbackException)
                null
            }
        }
    }
    
    private fun getPartialContent(
        tracker: PartialLocalLineStatusTracker,
        change: ChangeListChange
    ): String {
        return try {
            // For now, use a simplified approach that gets the full file content
            // The actual partial content extraction would require more complex API usage
            // that may vary between IntelliJ versions
            change.virtualFile?.contentsToByteArray()?.toString(Charsets.UTF_8) ?: ""
        } catch (e: Exception) {
            logger.warn("Failed to get content for partial commit: ${e.message}")
            ""
        }
    }
    
    /**
     * Check if a change represents a partial commit
     */
    fun isPartialCommit(project: Project, change: Change): Boolean {
        return try {
            if (change is ChangeListChange) {
                val tracker = PartialChangesUtil.getPartialTracker(project, change)
                tracker != null && tracker.hasPartialChangesToCommit()
            } else {
                false
            }
        } catch (e: Exception) {
            logger.debug("Error checking partial commit status: ${e.message}")
            false
        }
    }
    
    /**
     * Get all committed content for a list of changes, handling partial commits
     */
    fun getAllCommittedContent(
        project: Project,
        changes: List<Change>
    ): List<FileContent> {
        return changes.mapNotNull { change ->
            try {
                getCommittedContent(project, change)
            } catch (e: Exception) {
                logger.warn("Failed to process change for ${change.virtualFile?.path}: ${e.message}")
                null
            }
        }
    }
}