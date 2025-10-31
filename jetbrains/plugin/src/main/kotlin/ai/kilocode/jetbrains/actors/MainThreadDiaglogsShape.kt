// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

package ai.kilocode.jetbrains.actors

import ai.kilocode.jetbrains.util.URI
import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.application.ModalityState
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.fileChooser.FileChooser
import com.intellij.openapi.fileChooser.FileChooserDescriptor
import com.intellij.openapi.fileChooser.FileChooserFactory
import com.intellij.openapi.fileChooser.FileSaverDescriptor
import kotlinx.coroutines.suspendCancellableCoroutine
import java.io.File
import java.nio.file.Path
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/**
 * Configuration options for the open file dialog.
 * This data class encapsulates all the parameters needed to customize the file chooser dialog.
 *
 * @property defaultUri The default URI/path to start browsing from
 * @property openLabel Custom label text for the dialog's open button
 * @property canSelectFiles Whether files can be selected in the dialog
 * @property canSelectFolders Whether folders can be selected in the dialog
 * @property canSelectMany Whether multiple items can be selected simultaneously
 * @property filters File extension filters for filtering displayed files (format: {"Description": ["ext1", "ext2"]})
 * @property title Custom title for the dialog window
 * @property allowUIResources Whether to allow UI resources to be selected
 */
data class MainThreadDialogOpenOptions(
    val defaultUri: Map<String, String?>?,
    val openLabel: String?,
    val canSelectFiles: Boolean?,
    val canSelectFolders: Boolean?,
    val canSelectMany: Boolean?,
    val filters: MutableMap<String, MutableList<String>>?,
    val title: String?,
    val allowUIResources: Boolean?,
)

/**
 * Interface defining the contract for main thread dialog operations.
 * This interface provides methods for showing file open and save dialogs that must be executed on the main UI thread.
 */
interface MainThreadDiaglogsShape : Disposable {
    /**
     * Shows an open file dialog and returns the selected file URIs.
     *
     * @param options Configuration options for customizing the dialog behavior
     * @return List of selected file URIs, or null if the dialog was cancelled
     */
    suspend fun showOpenDialog(options: Map<String, Any?>?): MutableList<URI>?

    /**
     * Shows a save file dialog and returns the selected file URI.
     *
     * @param options Configuration options for customizing the dialog behavior
     * @return The selected file URI for saving, or null if the dialog was cancelled
     */
    suspend fun showSaveDialog(options: Map<String, Any?>?): URI?
}

/**
 * Implementation of MainThreadDiaglogsShape that provides file dialog functionality
 * executed on the IntelliJ platform's main UI thread.
 *
 * This class handles both file open and save dialogs using IntelliJ's file chooser APIs,
 * ensuring all UI operations are performed on the main thread as required by the platform.
 */
class MainThreadDiaglogs : MainThreadDiaglogsShape {
    private val logger = Logger.getInstance(MainThreadDiaglogs::class.java)

    /**
     * Shows an open file dialog with the specified options.
     *
     * This method creates a file chooser dialog that allows users to select one or more files
     * based on the provided configuration. The operation is performed on the main UI thread
     * using IntelliJ's invokeLater mechanism.
     *
     * @param map Configuration map containing dialog options
     * @return Mutable list of selected file URIs, or null if cancelled
     */
    override suspend fun showOpenDialog(map: Map<String, Any?>?): MutableList<URI>? {
        // Convert the configuration map to typed options
        val options = create(map)

        // Create file chooser descriptor with default values for unspecified options
        val descriptor = FileChooserDescriptor(
            /* chooseFiles = */
            true,
            /* chooseFolders = */
            options?.canSelectFolders ?: true,
            /* chooseJars = */
            false,
            /* chooseJarsAsFiles = */
            false,
            /* chooseMultipleJars = */
            false,
            /* chooseMultiple = */
            options?.canSelectMany ?: true,
        )
            .withTitle(options?.title ?: "Open")
            .withDescription(options?.openLabel ?: "Select files")

        // Apply file extension filters if provided
        options?.filters?.forEach { (name, extensions) ->
            descriptor.withFileFilter { file ->
                extensions.any { file.extension?.equals(it, true) ?: false }
            }
        }

        // Use coroutine to handle the asynchronous file chooser operation
        return suspendCancellableCoroutine { continuation ->
            ApplicationManager.getApplication().invokeLater({
                try {
                    // Show the file chooser dialog and get selected files
                    val files = FileChooser.chooseFiles(descriptor, null, null)

                    // Convert IntelliJ VirtualFile objects to URI objects
                    val result = files.map { file ->
                        URI.file(file.path)
                    }.toMutableList()

                    // Resume coroutine with the result
                    continuation.resume(result)
                } catch (e: Exception) {
                    // Resume coroutine with exception if an error occurs
                    continuation.resumeWithException(e)
                }
            }, ModalityState.defaultModalityState())
        }
    }

    /**
     * Shows a save file dialog with the specified options.
     *
     * This method creates a file saver dialog that allows users to select a location
     * and filename for saving a file. The operation is performed on the main UI thread.
     *
     * @param map Configuration map containing dialog options
     * @return URI of the selected save location, or null if cancelled
     */
    override suspend fun showSaveDialog(map: Map<String, Any?>?): URI? {
        // Convert the configuration map to typed options
        val options = create(map)

        // Create file saver descriptor with custom title and description
        val descriptor = FileSaverDescriptor("Save", options?.openLabel ?: "Select save location")

        // Apply file extension filters if provided
        options?.filters?.forEach { (name, extensions) ->
            descriptor.withFileFilter { file ->
                extensions.any { file.extension?.equals(it, true) ?: false }
            }
        }

        // Extract default path and filename from options
        val path = options?.defaultUri?.get("path")
        var fileName: String? = null

        // Convert the path string to a Path object and extract filename
        val virtualFile = path?.let { filePath ->
            val file = File(filePath)
            fileName = file.name
            Path.of(file.parentFile.absolutePath)
        }

        // Use coroutine to handle the asynchronous save dialog operation
        return suspendCancellableCoroutine { continuation ->
            ApplicationManager.getApplication().invokeLater({
                try {
                    // Show the save file dialog and get the selected file
                    val file = FileChooserFactory.getInstance()
                        .createSaveFileDialog(descriptor, null)
                        .save(virtualFile, fileName)

                    // Convert the result to URI format
                    val result = file?.let { URI.file(it.file.absolutePath) }

                    // Resume coroutine with the result
                    continuation.resume(result)
                } catch (e: Exception) {
                    // Resume coroutine with exception if an error occurs
                    continuation.resumeWithException(e)
                }
            }, ModalityState.defaultModalityState())
        }
    }

    /**
     * Creates a MainThreadDialogOpenOptions instance from a configuration map.
     *
     * This helper method safely extracts typed values from a generic map structure
     * and constructs a properly typed configuration object.
     *
     * @param map Configuration map containing dialog options as key-value pairs
     * @return MainThreadDialogOpenOptions instance, or null if map is null
     */
    private fun create(map: Map<String, Any?>?): MainThreadDialogOpenOptions? {
        map?.let {
            @Suppress("UNCHECKED_CAST")
            return MainThreadDialogOpenOptions(
                defaultUri = it["defaultUri"] as? Map<String, String?>,
                openLabel = it["openLabel"] as? String,
                canSelectFiles = it["canSelectFiles"] as? Boolean,
                canSelectFolders = it["canSelectFolders"] as? Boolean,
                canSelectMany = it["canSelectMany"] as? Boolean,
                filters = it["filters"] as? MutableMap<String, MutableList<String>>,
                title = it["title"] as? String,
                allowUIResources = it["allowUIResources"] as? Boolean,
            )
        } ?: return null
    }

    /**
     * Disposes of any resources held by this dialog handler.
     *
     * This method is called when the plugin or component is being shut down,
     * allowing for proper cleanup of resources.
     */
    override fun dispose() {
        logger.info("Disposing MainThreadDiaglogs")
    }
}
