// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

package ai.kilocode.jetbrains.git

import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.project.Project
import java.io.File

/**
 * Utility class for resolving workspace paths in JetBrains projects.
 * Provides shared logic for determining Git repository roots and project workspace paths.
 */
object WorkspaceResolver {
    private val logger: Logger = Logger.getInstance(WorkspaceResolver::class.java)

    /**
     * Determines the workspace path for the given project.
     * 
     * The resolution strategy follows this priority order:
     * 1. Look for Git repository in the project's base directory
     * 2. Traverse parent directories to find the Git repository root
     * 3. Fall back to project base path even if no .git directory is found
     * 4. Return null if project has no base path
     *
     * This method handles common edge cases including:
     * - Projects that are subdirectories of Git repositories
     * - Projects that are not in Git repositories at all
     * - Projects with missing or invalid base paths
     *
     * @param project The current IntelliJ project
     * @return The absolute workspace path or null if not determinable
     */
    fun getWorkspacePath(project: Project): String? {
        logger.debug("Resolving workspace path for project: ${project.name}")
        
        // Try to get the project base path
        val basePath = project.basePath
        if (basePath == null) {
            logger.warn("Project ${project.name} has no base path")
            return null
        }

        val baseDir = File(basePath)
        if (!baseDir.exists()) {
            logger.warn("Project base directory does not exist: $basePath")
            return null
        }

        // Check if this directory is a Git repository
        val gitDir = File(baseDir, ".git")
        if (gitDir.exists()) {
            logger.debug("Found Git repository at project base path: ${baseDir.absolutePath}")
            return baseDir.absolutePath
        }

        // Look for Git repository in parent directories
        var currentDir = baseDir.parentFile
        while (currentDir != null) {
            val parentGitDir = File(currentDir, ".git")
            if (parentGitDir.exists()) {
                logger.debug("Found Git repository in parent directory: ${currentDir.absolutePath}")
                return currentDir.absolutePath
            }
            currentDir = currentDir.parentFile
        }

        // Fall back to project base path even if no .git directory found
        logger.debug("No Git repository found, falling back to project base path: ${baseDir.absolutePath}")
        return baseDir.absolutePath
    }

    /**
     * Checks if the given project is within a Git repository.
     *
     * @param project The current IntelliJ project
     * @return true if the project or any parent directory contains a .git folder
     */
    fun isGitRepository(project: Project): Boolean {
        val basePath = project.basePath ?: return false
        val baseDir = File(basePath)
        
        // Check current directory and all parent directories
        var currentDir: File? = baseDir
        while (currentDir != null) {
            if (File(currentDir, ".git").exists()) {
                return true
            }
            currentDir = currentDir.parentFile
        }
        
        return false
    }

    /**
     * Finds the Git repository root for the given project.
     *
     * @param project The current IntelliJ project
     * @return The absolute path to the Git repository root, or null if no repository found
     */
    fun getGitRepositoryRoot(project: Project): String? {
        val basePath = project.basePath ?: return null
        val baseDir = File(basePath)
        
        // Check current directory and all parent directories
        var currentDir: File? = baseDir
        while (currentDir != null) {
            if (File(currentDir, ".git").exists()) {
                return currentDir.absolutePath
            }
            currentDir = currentDir.parentFile
        }
        
        return null
    }
}