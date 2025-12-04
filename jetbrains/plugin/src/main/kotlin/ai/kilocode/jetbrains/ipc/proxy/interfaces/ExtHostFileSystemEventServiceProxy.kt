// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

package ai.kilocode.jetbrains.ipc.proxy.interfaces

import java.util.concurrent.CompletableFuture

/**
 * File system events interface
 * Corresponds to FileSystemEvents in VSCode
 */
data class FileSystemEvents(
    val session: String? = null,
    val created: List<Map<String, Any?>>, // UriComponents
    val changed: List<Map<String, Any?>>, // UriComponents
    val deleted: List<Map<String, Any?>>, // UriComponents
)

/**
 * Source-target file pair
 * Corresponds to SourceTargetPair in VSCode
 */
data class SourceTargetPair(
    val source: Map<String, Any?>? = null, // UriComponents
    val target: Map<String, Any?>, // UriComponents
)

/**
 * File operation participation response
 * Corresponds to IWillRunFileOperationParticipation in VSCode
 */
data class FileOperationParticipation(
    val edit: Map<String, Any?>, // IWorkspaceEditDto
    val extensionNames: List<String>,
)

/**
 * File operation type
 * Corresponds to FileOperation in VSCode
 */
enum class FileOperation {
    CREATE,
    DELETE,
    RENAME,
    COPY,
    MOVE,
}

/**
 * Extension host file system event service interface
 * Corresponds to ExtHostFileSystemEventServiceShape in VSCode
 */
interface ExtHostFileSystemEventServiceProxy {
    /**
     * File event notification
     * Corresponds to $onFileEvent in VSCode
     * @param events File system events
     */
    fun onFileEvent(events: FileSystemEvents)

    /**
     * Will run file operation notification
     * Corresponds to $onWillRunFileOperation in VSCode
     * @param operation File operation type
     * @param files List of source-target file pairs
     * @param timeout Timeout
     * @param token Cancellation token
     * @return File operation participation response
     */
    fun onWillRunFileOperation(
        operation: FileOperation,
        files: List<SourceTargetPair>,
        timeout: Int,
        token: Any?,
    ): CompletableFuture<FileOperationParticipation?>

    /**
     * Did run file operation notification
     * Corresponds to $onDidRunFileOperation in VSCode
     * @param operation File operation type
     * @param files List of source-target file pairs
     */
    fun onDidRunFileOperation(
        operation: FileOperation,
        files: List<SourceTargetPair>,
    )
}
