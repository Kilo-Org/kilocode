// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

package ai.kilocode.jetbrains.core

import ai.kilocode.jetbrains.model.StaticWorkspaceData
import ai.kilocode.jetbrains.model.WorkspaceData
import ai.kilocode.jetbrains.model.WorkspaceFolder
import ai.kilocode.jetbrains.util.URI
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.Service
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.LocalFileSystem
import com.intellij.openapi.vfs.VirtualFile
import java.util.*

/**
 * Workspace Manager
 * Responsible for retrieving and managing IDEA workspace information.
 * Provides functionality to access project workspace data and folders.
 */
@Service(Service.Level.PROJECT)
class WorkspaceManager(val project: Project) {
    private val logger = Logger.getInstance(WorkspaceManager::class.java)

    /**
     * Gets the current workspace data.
     * @return Workspace data or null (if no project is open)
     */
    fun getCurrentWorkspaceData(): WorkspaceData? {
        return getProjectWorkspaceData(project)
    }

    /**
     * Gets workspace data for a specific project.
     *
     * @param project The project to get workspace data for
     * @return Workspace data or null if the project is null
     */
    fun getProjectWorkspaceData(project: Project): WorkspaceData {
        // Create workspace ID (using hash value of the project's base path)
        val workspaceId = getWorkspaceId(project)
        val workspaceName = project.name

        // Create static workspace data
        val staticWorkspaceData = StaticWorkspaceData(
            id = workspaceId,
            name = workspaceName,
            transient = false,
            // Configuration can be the project's .idea directory or project configuration file
            configuration = project.basePath?.let { URI.file("$it/.idea") },
            isUntitled = false,
        )

        // Get workspace folders
        val workspaceFolders = getWorkspaceFolders(project)

        return WorkspaceData(staticWorkspaceData, workspaceFolders)
    }

    /**
     * Gets the workspace ID for a project.
     *
     * @param project The project
     * @return The workspace ID as a string
     */
    private fun getWorkspaceId(project: Project): String {
        // Use the hash value of the project path as ID
        val basePath = project.basePath ?: return UUID.randomUUID().toString()
        return basePath.hashCode().toString()
    }

    /**
     * Gets workspace folders for a project.
     *
     * @param project The project
     * @return List of workspace folders
     */
    private fun getWorkspaceFolders(project: Project): List<WorkspaceFolder> {
        val folders = mutableListOf<WorkspaceFolder>()
        val basePath = project.basePath ?: return folders

        // Add project root directory as the main workspace folder
        folders.add(
            WorkspaceFolder(
                uri = URI.file(basePath),
                name = project.name,
                index = 0,
            ),
        )

        // Get the virtual file for the project root directory - wrapped in ReadAction
        val projectDir = ApplicationManager.getApplication().runReadAction<VirtualFile?> {
            LocalFileSystem.getInstance().findFileByPath(basePath)
        }
        if (projectDir == null || !projectDir.isDirectory) {
            return folders
        }

//        // Get subdirectories
//        val contentRoots = projectDir.children
//
//        // Filter files to get subfolders
//        val subFolders = contentRoots.filter { file: VirtualFile ->
//            file.isDirectory &&
//            !file.name.startsWith(".") &&
//            file.name !in listOf("out", "build", "target", "node_modules", ".idea", "dist", "bin", "obj")
//        }
//
//        // Add subfolders
//        subFolders.forEachIndexed { index, folder ->
//            if (folder.path != basePath) {
//                folders.add(WorkspaceFolder(
//                    uri = URI.file(folder.path),
//                    name = folder.name,
//                    index = index + 1  // Start from 1, because 0 is the project root directory
//                ))
//            }
//        }

        return folders
    }
}
