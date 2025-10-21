// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

package ai.kilocode.jetbrains.workspace

import ai.kilocode.jetbrains.core.PluginContext
import ai.kilocode.jetbrains.core.ServiceProxyRegistry
import ai.kilocode.jetbrains.core.WorkspaceManager
import ai.kilocode.jetbrains.events.FileChangeType
import ai.kilocode.jetbrains.events.ProjectEventBus
import ai.kilocode.jetbrains.events.WorkspaceDirectoriesChangeEvent
import ai.kilocode.jetbrains.events.WorkspaceDirectoryChangeEvent
import ai.kilocode.jetbrains.events.WorkspaceFileChangeData
import ai.kilocode.jetbrains.events.WorkspaceFileChangeEvent
import ai.kilocode.jetbrains.events.WorkspaceFilesChangeData
import ai.kilocode.jetbrains.events.WorkspaceFilesChangeEvent
import ai.kilocode.jetbrains.events.WorkspaceRootChangeData
import ai.kilocode.jetbrains.events.WorkspaceRootChangeEvent
import ai.kilocode.jetbrains.ipc.proxy.interfaces.FileSystemEvents
import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.Service
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.project.Project
import com.intellij.openapi.project.ProjectManager
import com.intellij.openapi.project.ProjectManagerListener
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.openapi.vfs.VirtualFileManager
import com.intellij.openapi.vfs.newvfs.BulkFileListener
import com.intellij.openapi.vfs.newvfs.events.VFileContentChangeEvent
import com.intellij.openapi.vfs.newvfs.events.VFileCopyEvent
import com.intellij.openapi.vfs.newvfs.events.VFileCreateEvent
import com.intellij.openapi.vfs.newvfs.events.VFileDeleteEvent
import com.intellij.openapi.vfs.newvfs.events.VFileEvent
import com.intellij.openapi.vfs.newvfs.events.VFileMoveEvent
import com.intellij.openapi.vfs.newvfs.events.VFilePropertyChangeEvent
import com.intellij.util.messages.MessageBusConnection
import java.util.concurrent.ConcurrentHashMap

/**
 * Workspace file change manager
 * Listens for creation, modification, deletion, and other changes of files in the workspace, and sends corresponding events
 */
@Service(Service.Level.PROJECT)
class WorkspaceFileChangeManager(val project: Project) : Disposable {
    private val logger = Logger.getInstance(WorkspaceFileChangeManager::class.java)

    // Record registered file listener connections
    private val vfsConnections = ConcurrentHashMap<Project, MessageBusConnection>()

    // Record project workspace directory paths
    private val projectWorkspacePaths = ConcurrentHashMap<Project, String>()

    // Project connection
    private var projectConnection: MessageBusConnection? = null

    // Project listener
    private val projectListener = object : ProjectManagerListener {
        override fun projectOpened(project: Project) {
            registerFileListener(project)
            // Record initial project workspace directory
            project.basePath?.let { projectWorkspacePaths[project] = it }
            // Trigger workspace root change event
            triggerWorkspaceRootChangeEvent(project, null, project.basePath ?: "")
        }

        override fun projectClosed(project: Project) {
            unregisterFileListener(project)
            // Remove project workspace directory record
            projectWorkspacePaths.remove(project)
        }
    }

    init {
        logger.info("Initialize workspace file change manager")

        // Listen for project open/close events
        projectConnection = ApplicationManager.getApplication().messageBus.connect(this)
        projectConnection?.subscribe(ProjectManager.TOPIC, projectListener)

        // Register file listeners for already opened projects
        val openProjects = ProjectManager.getInstance().openProjects
        for (project in openProjects) {
            registerFileListener(project)
            // Record workspace directory for opened projects
            project.basePath?.let { projectWorkspacePaths[project] = it }
        }
    }

    /**
     * Trigger workspace root change event
     * @param project Project
     * @param oldPath Old workspace directory path
     * @param newPath New workspace directory path
     */
    private fun triggerWorkspaceRootChangeEvent(project: Project, oldPath: String?, newPath: String) {
        logger.info("Trigger workspace root change event: ${project.name}, old path: $oldPath, new path: $newPath")

        // Create workspace root change data
        val workspaceChangeData = WorkspaceRootChangeData(project, oldPath, newPath)

        // Send workspace root change event via EventBus
        project.getService(ProjectEventBus::class.java).emitInApplication(WorkspaceRootChangeEvent, workspaceChangeData)

        // Get ExtHostWorkspace proxy
        val extHostWorkspace = PluginContext.getInstance(project).getRPCProtocol()?.getProxy(ServiceProxyRegistry.ExtHostContext.ExtHostWorkspace)

        // Get current workspace data
        val workspaceData = project.getService(WorkspaceManager::class.java).getProjectWorkspaceData(project)

        extHostWorkspace?.let {
            logger.info("Send workspace root change to extension process: ${workspaceData.name}, folders: ${workspaceData.folders.size}")
            it.acceptWorkspaceData(workspaceData)
        }
    }

    /**
     * Register file listener
     * @param project Project to listen to
     */
    private fun registerFileListener(project: Project) {
        if (vfsConnections.containsKey(project)) {
            logger.info("File listener for project ${project.name} already exists, skip registration")
            return
        }

        logger.info("Register file listener for project ${project.name}")

        try {
            // Create connection and subscribe to VFS change events
            val connection = project.messageBus.connect()

            // Add virtual file system listener
            connection.subscribe(
                VirtualFileManager.VFS_CHANGES,
                object : BulkFileListener {
                    override fun after(events: List<VFileEvent>) {
                        processBulkFileEvents(events, project)
                    }
                },
            )

            // Save connection for later cleanup
            vfsConnections[project] = connection
        } catch (e: Exception) {
            logger.error("Failed to register file listener for project ${project.name}", e)
        }
    }

    /**
     * Unregister file listener
     * @param project Project to unregister listener from
     */
    private fun unregisterFileListener(project: Project) {
        val connection = vfsConnections.remove(project)
        if (connection != null) {
            logger.info("Unregister file listener for project ${project.name}")

            try {
                connection.disconnect()
            } catch (e: Exception) {
                logger.error("Failed to unregister file listener for project ${project.name}", e)
            }
        }
    }

    /**
     * Process bulk file events
     * @param events List of file events
     * @param project Related project
     */
    private fun processBulkFileEvents(events: List<VFileEvent>, project: Project) {
        if (events.isEmpty()) {
            return
        }

        // Collect all file changes
        val fileChanges = mutableListOf<WorkspaceFileChangeData>()
        val directoryChanges = mutableListOf<WorkspaceFileChangeData>()

        events.forEach { event ->
            val file = when (event) {
                is VFileCreateEvent -> event.file
                is VFileDeleteEvent -> event.file
                is VFileMoveEvent -> event.file
                is VFileCopyEvent -> event.file
                is VFilePropertyChangeEvent -> event.file
                is VFileContentChangeEvent -> event.file
                else -> null
            }

            if (file != null) {
                // Determine change type
                val changeType = when (event) {
                    is VFileCreateEvent -> FileChangeType.CREATED
                    is VFileDeleteEvent -> FileChangeType.DELETED
                    else -> FileChangeType.UPDATED
                }

                // Skip irrelevant files or directories
                if (isRelevantFileSystemItem(file, project)) {
                    val changeData = WorkspaceFileChangeData(file, changeType)

                    // Store by type
                    if (file.isDirectory) {
                        directoryChanges.add(changeData)
                        // Trigger event for each directory change
                        triggerDirectoryChangeEvent(changeData)
                    } else {
                        fileChanges.add(changeData)
                        // Trigger event for each file change
                        triggerFileChangeEvent(changeData)
                    }
                }
            }
        }

        // Trigger bulk file change event
        if (fileChanges.isNotEmpty()) {
            triggerBulkFileChangeEvent(fileChanges, project)
        }

        // Trigger bulk directory change event
        if (directoryChanges.isNotEmpty()) {
            triggerBulkDirectoryChangeEvent(directoryChanges, project)
        }
    }

    /**
     * Trigger file change event
     * @param fileChangeData File change data
     */
    private fun triggerFileChangeEvent(fileChangeData: WorkspaceFileChangeData) {
        logger.info("File changed: ${fileChangeData.file.path}, type: ${fileChangeData.changeType}")

        // Send single file change event via EventBus
        project.getService(ProjectEventBus::class.java).emitInApplication(WorkspaceFileChangeEvent, fileChangeData)
    }

    /**
     * Trigger directory change event
     * @param directoryChangeData Directory change data
     */
    private fun triggerDirectoryChangeEvent(directoryChangeData: WorkspaceFileChangeData) {
        logger.info("Directory changed: ${directoryChangeData.file.path}, type: ${directoryChangeData.changeType}")

        // Send single directory change event via EventBus
        project.getService(ProjectEventBus::class.java).emitInApplication(WorkspaceDirectoryChangeEvent, directoryChangeData)
    }

    /**
     * Trigger bulk file change event
     * @param fileChanges List of file changes
     */
    private fun triggerBulkFileChangeEvent(fileChanges: List<WorkspaceFileChangeData>, project: Project) {
        logger.info("Bulk file change, total ${fileChanges.size} files")

        val proxy = PluginContext.getInstance(project).getRPCProtocol()?.getProxy(ServiceProxyRegistry.ExtHostContext.ExtHostFileSystemEventService)
        proxy?.let {
            // Convert file change data to FileSystemEvents format
            val createdFiles = mutableListOf<Map<String, Any?>>()
            val changedFiles = mutableListOf<Map<String, Any?>>()
            val deletedFiles = mutableListOf<Map<String, Any?>>()

            // Classify files by change type
            fileChanges.forEach { fileChange ->
                val uriComponents = fileToUriComponents(fileChange.file)
                when (fileChange.changeType) {
                    FileChangeType.CREATED -> createdFiles.add(uriComponents)
                    FileChangeType.UPDATED -> changedFiles.add(uriComponents)
                    FileChangeType.DELETED -> deletedFiles.add(uriComponents)
                }
            }

            // Create FileSystemEvents object and send
            val fileSystemEvents = FileSystemEvents(
                session = fileChanges[0].timestamp.toString(),
                created = createdFiles,
                changed = changedFiles,
                deleted = deletedFiles,
            )

            // Call onFileEvent method of extension host file system event service
            it.onFileEvent(fileSystemEvents)
        }

        // Send bulk file change event via EventBus
        val bulkChangeData = WorkspaceFilesChangeData(fileChanges)
        project.getService(ProjectEventBus::class.java).emitInApplication(WorkspaceFilesChangeEvent, bulkChangeData)
    }

    /**
     * Trigger bulk directory change event
     * @param directoryChanges List of directory changes
     */
    private fun triggerBulkDirectoryChangeEvent(directoryChanges: List<WorkspaceFileChangeData>, project: Project) {
        logger.info("Bulk directory change, total ${directoryChanges.size} directories")

        val proxy = PluginContext.getInstance(project).getRPCProtocol()?.getProxy(ServiceProxyRegistry.ExtHostContext.ExtHostFileSystemEventService)
        proxy?.let {
            // Convert directory change data to FileSystemEvents format
            val createdDirs = mutableListOf<Map<String, Any?>>()
            val changedDirs = mutableListOf<Map<String, Any?>>()
            val deletedDirs = mutableListOf<Map<String, Any?>>()

            // Classify directories by change type
            directoryChanges.forEach { dirChange ->
                val uriComponents = fileToUriComponents(dirChange.file)
                when (dirChange.changeType) {
                    FileChangeType.CREATED -> createdDirs.add(uriComponents)
                    FileChangeType.UPDATED -> changedDirs.add(uriComponents)
                    FileChangeType.DELETED -> deletedDirs.add(uriComponents)
                }
            }

            // Create FileSystemEvents object and send
            val fileSystemEvents = FileSystemEvents(
                session = directoryChanges[0].timestamp.toString(),
                created = createdDirs,
                changed = changedDirs,
                deleted = deletedDirs,
            )

            // Call onFileEvent method of extension host file system event service
            it.onFileEvent(fileSystemEvents)
        }

        // Send bulk directory change event via EventBus
        val bulkChangeData = WorkspaceFilesChangeData(directoryChanges)
        project.getService(ProjectEventBus::class.java).emitInApplication(WorkspaceDirectoriesChangeEvent, bulkChangeData)
    }

    /**
     * Convert VirtualFile to URI components map
     * @param file Virtual file
     * @return URI components map
     */
    private fun fileToUriComponents(file: VirtualFile): Map<String, Any?> {
        // Build component map conforming to VSCode URI format
        return mapOf(
            "scheme" to "file",
            "path" to file.path,
            "authority" to "",
            "query" to "",
            "fragment" to "",
        )
    }

    /**
     * Check if file or directory is relevant to the project
     * @param file File or directory to check
     * @param project Project
     * @return Whether the file or directory is relevant to the project
     */
    private fun isRelevantFileSystemItem(file: VirtualFile, project: Project): Boolean {
        // Ignore hidden files and directories
        if (file.name.startsWith(".") || file.path.contains("/.")) {
            return false
        }

        // For files, ignore temporary files
        if (!file.isDirectory && (file.name.endsWith("~") || file.name.endsWith(".tmp"))) {
            return false
        }

        return true
    }

    override fun dispose() {
        logger.info("Release workspace file change manager resources")

        try {
            // Disconnect project listener connection
            projectConnection?.disconnect()
            projectConnection = null

            // Release all file listener connections
            vfsConnections.forEach { (project, connection) ->
                try {
                    logger.info("Unregister file listener for project ${project.name}")
                    connection.disconnect()
                } catch (e: Exception) {
                    logger.error("Failed to unregister file listener for project ${project.name}", e)
                }
            }

            vfsConnections.clear()
        } catch (e: Exception) {
            logger.error("Failed to release workspace file change manager resources", e)
        }
    }
}
