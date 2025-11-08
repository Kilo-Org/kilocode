// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

package ai.kilocode.jetbrains.git

import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.project.Project
import com.intellij.openapi.ui.Messages
import java.io.File

/**
 * Utility class for resolving workspace paths in JetBrains projects.
 * Provides shared logic for determining Git repository roots and project workspace paths.
 */
object WorkspaceResolver {
    private val logger: Logger = Logger.getInstance(WorkspaceResolver::class.java)

    /**
     * Gets the validated base directory for a project.
     * Returns null if project has no base path or the directory doesn't exist.
     */
    private fun getValidatedBaseDirectory(project: Project): File? {
        val basePath = project.basePath ?: return null
        val baseDir = File(basePath)
        return if (baseDir.exists()) baseDir else null
    }

    /**
     * Finds Git repository starting from the given directory.
     * Traverses up the directory tree looking for .git folders.
     */
    private fun findGitRepository(startDir: File): File? {
        return generateSequence(startDir) { it.parentFile }
            .find { File(it, ".git").exists() }
    }

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

        val baseDir = getValidatedBaseDirectory(project)
        if (baseDir == null) {
            logger.warn("Project ${project.name} has no valid base path")
            return null
        }

        val gitRepo = findGitRepository(baseDir)
        return if (gitRepo != null) {
            logger.debug("Found Git repository at: ${gitRepo.absolutePath}")
            gitRepo.absolutePath
        } else {
            logger.debug("No Git repository found, falling back to project base path: ${baseDir.absolutePath}")
            baseDir.absolutePath
        }
    }

    /**
     * Checks if the given project is within a Git repository.
     *
     * @param project The current IntelliJ project
     * @return true if the project or any parent directory contains a .git folder
     */
    fun isGitRepository(project: Project): Boolean {
        val baseDir = getValidatedBaseDirectory(project) ?: return false
        return findGitRepository(baseDir) != null
    }

    /**
     * Finds the Git repository root for the given project.
     *
     * @param project The current IntelliJ project
     * @return The absolute path to the Git repository root, or null if no repository found
     */
    fun getGitRepositoryRoot(project: Project): String? {
        val baseDir = getValidatedBaseDirectory(project) ?: return null
        return findGitRepository(baseDir)?.absolutePath
    }

    /**
     * Gets the workspace path for the given project, showing an error dialog if resolution fails.
     * This is a convenience method that combines workspace path resolution with error handling.
     *
     * @param project The current IntelliJ project
     * @param errorMessage The error message to display if workspace path cannot be resolved
     * @param errorTitle The title of the error dialog
     * @return The workspace path if successful, null if resolution failed (error dialog shown)
     */
    fun getWorkspacePathOrShowError(
        project: Project,
        errorMessage: String,
        errorTitle: String,
    ): String? {
        val workspacePath = getWorkspacePath(project)
        if (workspacePath == null) {
            logger.error("Failed to resolve workspace path for project: ${project.name}, basePath: ${project.basePath}")
            Messages.showErrorDialog(project, errorMessage, errorTitle)
        }
        return workspacePath
    }
}
