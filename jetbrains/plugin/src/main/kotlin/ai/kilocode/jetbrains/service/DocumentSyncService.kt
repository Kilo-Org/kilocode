// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

package ai.kilocode.jetbrains.service

import ai.kilocode.jetbrains.core.PluginContext
import ai.kilocode.jetbrains.core.ServiceProxyRegistry
import ai.kilocode.jetbrains.editor.EditorAndDocManager
import ai.kilocode.jetbrains.editor.ModelAddedData
import ai.kilocode.jetbrains.editor.createURI
import ai.kilocode.jetbrains.ipc.proxy.interfaces.ExtHostDocumentsProxy
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.editor.Document
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.VirtualFile

class DocumentSyncService(private val project: Project) {

    private val logger = Logger.getInstance(DocumentSyncService::class.java)
    private var extHostDocumentsProxy: ExtHostDocumentsProxy? = null

    private fun getExtHostDocumentsProxy(): ExtHostDocumentsProxy? {
        if (extHostDocumentsProxy == null) {
            try {
                val protocol = PluginContext.getInstance(project).getRPCProtocol()
                extHostDocumentsProxy = protocol?.getProxy(ServiceProxyRegistry.ExtHostContext.ExtHostDocuments)
                logger.debug("ExtHostDocumentsProxy initialized in DocumentSyncService")
            } catch (e: Exception) {
                logger.error("Failed to get ExtHostDocumentsProxy in DocumentSyncService", e)
            }
        }
        return extHostDocumentsProxy
    }

    suspend fun syncDocumentStateOnSave(virtualFile: VirtualFile, document: Document) {
        logger.info("Starting to sync document save state: ${virtualFile.path}")
        try {
            // Create URI object
            val uriMap = mapOf(
                "scheme" to "file",
                "authority" to "",
                "path" to virtualFile.path,
                "query" to "",
                "fragment" to "",
            )
            val uri = createURI(uriMap)

            // Get EditorAndDocManager to manage document state
            val editorAndDocManager = project.getService(EditorAndDocManager::class.java)

            // Find corresponding EditorHolder
            val editorHandles = editorAndDocManager.getEditorHandleByUri(uri)

            if (editorHandles.isNotEmpty()) {
                // If corresponding editor exists, update its state
                for (handle in editorHandles) {
                    // Read latest document content
                    val text = ApplicationManager.getApplication().runReadAction<String> {
                        document.text
                    }

                    // Create updated document data
                    val updatedDocument = ModelAddedData(
                        uri = handle.document.uri,
                        versionId = handle.document.versionId + 1,
                        lines = text.lines(),
                        EOL = handle.document.EOL,
                        languageId = handle.document.languageId,
                        isDirty = false, // Set to false after save
                        encoding = handle.document.encoding,
                    )

                    // Update document state in EditorHolder
                    handle.document = updatedDocument

                    // Trigger state sync to extension side
                    editorAndDocManager.updateDocumentAsync(updatedDocument)
                }

                // Send save event to extension process
                getExtHostDocumentsProxy()?.let { proxy ->
                    proxy.acceptModelSaved(uri)
                    logger.info("Document save event and state synced to extension host: ${virtualFile.path}")
                }
            }
        } catch (e: Exception) {
            logger.error("Error syncing document state on save", e)
        }
    }

    fun shouldHandleFileEvent(virtualFile: VirtualFile): Boolean {
        // Filter: only process real files (non-directory) and not temporary files
        return !virtualFile.isDirectory &&
            virtualFile.isInLocalFileSystem &&
            !virtualFile.path.contains("/.idea/") && // Exclude IDE configuration files
            !virtualFile.path.contains("/target/") && // Exclude build output files
            !virtualFile.path.contains("/build/") &&
            !virtualFile.path.contains("/node_modules/") &&
            virtualFile.extension != null && // Ensure file has extension
            !isTooLargeForSyncing(virtualFile) && // Exclude files that are too large for syncing
            !isForSimpleWidget(virtualFile) // Exclude simple widget files
    }

    /**
     * Check if file is too large for syncing
     * Reference VS Code implementation, exclude files over 2MB
     */
    private fun isTooLargeForSyncing(virtualFile: VirtualFile): Boolean {
        return try {
            val maxSizeBytes = 2 * 1024 * 1024L // 2MB
            virtualFile.length > maxSizeBytes
        } catch (e: Exception) {
            logger.warn("Failed to check file size for: ${virtualFile.path}", e)
            false
        }
    }

    /**
     * Check if file is for simple widget use
     * Exclude special purpose file types
     */
    private fun isForSimpleWidget(virtualFile: VirtualFile): Boolean {
        return try {
            // Exclude special file types
            val fileName = virtualFile.name.lowercase()
            val extension = virtualFile.extension?.lowercase()

            // Temporary files, cache files, backup files, etc.
            fileName.startsWith(".") ||
                fileName.endsWith(".tmp") ||
                fileName.endsWith(".temp") ||
                fileName.endsWith(".bak") ||
                fileName.endsWith(".backup") ||
                fileName.contains("~") ||
                // Binary file extensions
                extension in setOf(
                    "exe", "dll", "so", "dylib", "bin", "obj", "o", "a", "lib",
                    "zip", "tar", "gz", "rar", "7z", "jar", "war", "ear",
                    "png", "jpg", "jpeg", "gif", "bmp", "ico", "tiff",
                    "mp3", "mp4", "avi", "mov", "wav", "flv", "wmv",
                    "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx",
                ) ||
                // Special paths
                virtualFile.path.contains("/.git/") ||
                virtualFile.path.contains("/.svn/") ||
                virtualFile.path.contains("/.hg/") ||
                virtualFile.path.contains("/vendor/") ||
                virtualFile.path.contains("/dist/") ||
                virtualFile.path.contains("/out/")
        } catch (e: Exception) {
            logger.warn("Failed to check if file is for simple widget: ${virtualFile.path}", e)
            false
        }
    }

    fun dispose() {
        extHostDocumentsProxy = null
    }
}
