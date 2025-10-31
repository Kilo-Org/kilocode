// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

package ai.kilocode.jetbrains.actors

import ai.kilocode.jetbrains.editor.EditorAndDocManager
import ai.kilocode.jetbrains.editor.createURI
import ai.kilocode.jetbrains.service.DocumentSyncService
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.editor.Document
import com.intellij.openapi.fileEditor.FileDocumentManager
import com.intellij.openapi.fileEditor.FileDocumentManagerListener
import com.intellij.openapi.progress.ProcessCanceledException
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.LocalFileSystem
import com.intellij.util.messages.MessageBusConnection
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.io.File

interface MainThreadDocumentsShape {
    suspend fun tryCreateDocument(options: Map<String, Any?>?): Map<String, Any?>
    suspend fun tryOpenDocument(uri: Map<String, Any?>, options: Map<String, Any?>?): Map<String, Any?>
    suspend fun trySaveDocument(uri: Map<String, Any?>): Boolean
    suspend fun tryOpenDocument(map: Map<String, Any?>, options: String?): Map<String, Any?>
}

class MainThreadDocuments(var project: Project) : MainThreadDocumentsShape {
    val logger = Logger.getInstance(MainThreadDocuments::class.java)
    private var messageBusConnection: MessageBusConnection? = null
    private val documentSyncService = DocumentSyncService(project)

    /** Coroutine scope tied to this instance, cancelled in [dispose]. */
    private val coroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    init {
        setupDocumentSaveListener()
    }

    private fun setupDocumentSaveListener() {
        try {
            // Connect to the message bus
            messageBusConnection = ApplicationManager.getApplication().messageBus.connect()

            // Listen for document save events
            messageBusConnection?.subscribe(
                FileDocumentManagerListener.TOPIC,
                object : FileDocumentManagerListener {
                    override fun beforeDocumentSaving(document: Document) {
                        handleDocumentSaving(document)
                    }
                },
            )

            logger.info("Document save listener registered successfully")
        } catch (e: Exception) {
            logger.error("Failed to setup document save listener", e)
        }
    }

    private fun handleDocumentSaving(document: Document) {
        // Get the virtual file associated with the document
        val virtualFile = FileDocumentManager.getInstance().getFile(document)
        logger.info("Handle document save event: ${virtualFile?.path}")

        if (virtualFile != null && documentSyncService.shouldHandleFileEvent(virtualFile)) {
            // Handle in the coroutine scope dedicated to this instance to avoid issues with older IDEs lacking project.coroutineScope
            coroutineScope.launch {
                try {
                    // Wait a short time to ensure the save operation is complete
                    delay(50)
                    if (!project.isDisposed) {
                        documentSyncService.syncDocumentStateOnSave(virtualFile, document)
                    }
                } catch (e: ProcessCanceledException) {
                    // Normal control flow exception, can be ignored
                    logger.debug("Document save cancelled because project is disposed")
                } catch (e: Exception) {
                    logger.error("Error handling document save event", e)
                }
            }
        }
    }

    override suspend fun tryCreateDocument(options: Map<String, Any?>?): Map<String, Any?> {
        logger.info("tryCreateDocument$options")
        return mapOf()
    }

    override suspend fun tryOpenDocument(map: Map<String, Any?>, options: Map<String, Any?>?): Map<String, Any?> {
        val uri = createURI(map)
        logger.info("tryOpenDocument : ${uri.path}")

        val file = File(uri.path)
        val vfs = LocalFileSystem.getInstance()
        if (!file.exists()) {
            file.parentFile.mkdirs()
            val vf = vfs.findFileByIoFile(file.parentFile)
            ApplicationManager.getApplication().runWriteAction {
                vf?.createChildData(this, file.name)
            }
        }

        project.getService(EditorAndDocManager::class.java).openDocument(uri)

        logger.info("tryOpenDocument : ${uri.path} execution completed")
        return map
    }

    // This function is designed to work around a VS Code type system issue where a string argument may be incorrectly treated as an options: {} object. To prevent this, multiple function overloads are declared.
    override suspend fun tryOpenDocument(map: Map<String, Any?>, options: String?): Map<String, Any?> {
        return tryOpenDocument(map, HashMap())
    }

    override suspend fun trySaveDocument(map: Map<String, Any?>): Boolean {
        val uri = createURI(map)

        logger.info("trySaveDocument： ${uri.path}")

        project.getService(EditorAndDocManager::class.java).getEditorHandleByUri(uri, true)?.updateDocumentDirty(false) ?: run {
            logger.info("trySaveDocument： ${uri.path} not found")
            return false
        }
        logger.info("trySaveDocument： ${uri.path} execution completed")
        return true
    }

    fun dispose() {
        try {
            messageBusConnection?.disconnect()
            messageBusConnection = null
            documentSyncService.dispose()
            coroutineScope.cancel()
            logger.info("Document save listener disposed")
        } catch (e: Exception) {
            logger.error("Error disposing document save listener", e)
        }
    }
}
