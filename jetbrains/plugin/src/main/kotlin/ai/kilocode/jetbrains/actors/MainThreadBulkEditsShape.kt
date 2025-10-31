// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

package ai.kilocode.jetbrains.actors

import ai.kilocode.jetbrains.editor.EditorAndDocManager
import ai.kilocode.jetbrains.editor.EditorHolder
import ai.kilocode.jetbrains.editor.WorkspaceEdit
import ai.kilocode.jetbrains.ipc.proxy.SerializableObjectWithBuffers
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.LocalFileSystem
import java.io.File
import java.nio.file.Files
/**
 * Interface for handling bulk edits in the main thread.
 * Provides functionality to apply workspace edits that may include multiple file and text changes.
 */
interface MainThreadBulkEditsShape {
    /**
     * Attempts to apply a workspace edit.
     *
     * @param workspaceEditDto The workspace edit data transfer object
     * @param undoRedoGroupId Optional ID for grouping undo/redo operations
     * @param respectAutoSaveConfig Whether to respect auto-save configuration
     * @return True if all edits were applied successfully, false otherwise
     */
    suspend fun tryApplyWorkspaceEdit(workspaceEditDto: SerializableObjectWithBuffers<Any>, undoRedoGroupId: Int?, respectAutoSaveConfig: Boolean?): Boolean
}

/**
 * Implementation of MainThreadBulkEditsShape that handles bulk edits in the main thread.
 * Processes workspace edits including file operations (create, delete, rename) and text edits.
 *
 * @property project The current project context
 */
class MainThreadBulkEdits(val project: Project) : MainThreadBulkEditsShape {
    val logger = Logger.getInstance(MainThreadBulkEditsShape::class.java)

    /**
     * Attempts to apply a workspace edit by processing file operations and text edits.
     *
     * @param workspaceEditDto The workspace edit data transfer object
     * @param undoRedoGroupId Optional ID for grouping undo/redo operations
     * @param respectAutoSaveConfig Whether to respect auto-save configuration
     * @return True if all edits were applied successfully, false otherwise
     */
    override suspend fun tryApplyWorkspaceEdit(workspaceEditDto: SerializableObjectWithBuffers<Any>, undoRedoGroupId: Int?, respectAutoSaveConfig: Boolean?): Boolean {
        val json = workspaceEditDto.value as String
        logger.info("[Bulk Edit] Starting process: $json")
        val cto = WorkspaceEdit.from(json)
        var allSuccess = true

        // Process file edits - using background thread to avoid EDT violations
        cto.files.forEach { fileEdit ->
            if (fileEdit.oldResource != null && fileEdit.newResource != null) {
                val oldResource = File(fileEdit.oldResource.path)
                val newResource = File(fileEdit.newResource.path)
                try {
                    Files.move(oldResource.toPath(), newResource.toPath())
                    // Move VFS refresh operations to background thread
                    ApplicationManager.getApplication().executeOnPooledThread {
                        val vfs = LocalFileSystem.getInstance()
                        vfs.refreshIoFiles(listOf(oldResource, newResource))
                    }
                    logger.info("[Bulk Edit] Renamed file: ${oldResource.path} -> ${newResource.path}")
                } catch (e: Exception) {
                    logger.error("[Bulk Edit] Failed to rename file: ${oldResource.path} -> ${newResource.path}", e)
                    allSuccess = false
                }
            } else if (fileEdit.oldResource != null) {
                val oldResource = File(fileEdit.oldResource.path)
                try {
                    oldResource.delete()
                    // Move VFS refresh operations to background thread
                    ApplicationManager.getApplication().executeOnPooledThread {
                        val vfs = LocalFileSystem.getInstance()
                        vfs.refreshIoFiles(listOf(oldResource.parentFile))
                    }
                    logger.info("[Bulk Edit] Deleted file: ${oldResource.path}")
                } catch (e: Exception) {
                    logger.error("[Bulk Edit] Failed to delete file: ${oldResource.path}", e)
                    allSuccess = false
                }
            } else if (fileEdit.newResource != null) {
                val newResource = File(fileEdit.newResource.path)
                try {
                    val parentDir = newResource.parentFile
                    if (!parentDir.exists()) {
                        parentDir.mkdirs()
                    }
                    if (fileEdit.options?.contents != null) {
                        Files.write(newResource.toPath(), fileEdit.options!!.contents!!.toByteArray(Charsets.UTF_8))
                    } else {
                        newResource.createNewFile()
                    }
                    // Move VFS refresh operations to background thread
                    ApplicationManager.getApplication().executeOnPooledThread {
                        val vfs = LocalFileSystem.getInstance()
                        vfs.refreshIoFiles(listOf(newResource))
                    }
                    logger.info("[Bulk Edit] Created file: ${newResource.path}")
                } catch (e: Exception) {
                    logger.error("[Bulk Edit] Failed to create file: ${newResource.path}", e)
                    allSuccess = false
                }
            }
        }
        // Process text edits
        cto.texts.forEach { textEdit ->
            logger.info("[Bulk Edit] Processing text edit: ${textEdit.resource.path}")
            if (textEdit.resource.scheme != "file") {
                logger.error("[Bulk Edit] Non-file resources not supported: ${textEdit.resource.path}")
                allSuccess = false
                return@forEach
            }

            var handle: EditorHolder? = null
            try {
                handle = project.getService(EditorAndDocManager::class.java).getEditorHandleByUri(textEdit.resource, true)
                if (handle == null) {
                    handle = project.getService(EditorAndDocManager::class.java).sync2ExtHost(textEdit.resource, true)
                }
            } catch (e: Exception) {
                logger.info("[Bulk Edit] Failed to get editor handle: ${textEdit.resource.path}", e)
            }

            if (handle == null) {
                logger.info("[Bulk Edit] Editor handle not found: ${textEdit.resource.path}")
                allSuccess = false
                return@forEach
            }

            try {
                val result = handle.applyEdit(textEdit)
                if (!result) {
                    logger.info("[Bulk Edit] Failed to apply edit: ${textEdit.resource.path}")
                    allSuccess = false
                } else {
                    logger.info("[Bulk Edit] Successfully updated file: ${textEdit.resource.path}")
                }
            } catch (e: Exception) {
                logger.error("[Bulk Edit] Exception applying edit: ${textEdit.resource.path}", e)
                allSuccess = false
            }
        }
        return allSuccess
    }
}
