// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

package ai.kilocode.jetbrains.actors

import com.intellij.openapi.Disposable
import com.intellij.openapi.diagnostic.Logger
import java.io.File
import java.net.URI
import java.nio.file.Files
import java.nio.file.Paths
import java.nio.file.StandardCopyOption
import java.util.concurrent.ConcurrentHashMap

/**
 * File type enumeration.
 * Defines the possible types of files in the file system.
 */
enum class FileType {
    UNKNOWN,
    FILE,
    DIRECTORY,
    SYMBOLIC_LINK,
}

/**
 * File statistics information.
 * Contains metadata about a file including its type, creation time, modification time, and size.
 *
 * @property type The type of the file (file, directory, symbolic link, etc.)
 * @property ctime The creation time of the file in milliseconds since epoch
 * @property mtime The last modification time of the file in milliseconds since epoch
 * @property size The size of the file in bytes
 */
data class FileStat(
    val type: FileType,
    val ctime: Long,
    val mtime: Long,
    val size: Long,
)

/**
 * File system provider capabilities.
 * Defines the capabilities and features supported by a file system provider.
 *
 * @property isCaseSensitive Whether the file system is case-sensitive
 * @property isReadonly Whether the file system is read-only
 * @property isPathCaseSensitive Whether file paths are case-sensitive
 * @property canHandleFileUri Whether the provider can handle file URIs
 * @property hasFileCopy Whether the provider supports file copying
 * @property hasFolderCopy Whether the provider supports folder copying
 * @property hasOpenReadWriteCloseCapability Whether the provider supports open/read/write/close operations
 * @property hasLegacyWatchCapability Whether the provider supports legacy file watching
 * @property hasDiffCapability Whether the provider supports diff operations
 * @property hasFileChangeCapability Whether the provider supports file change notifications
 */
data class FileSystemProviderCapabilities(
    val isCaseSensitive: Boolean,
    val isReadonly: Boolean,
    val isPathCaseSensitive: Boolean,
    val canHandleFileUri: Boolean,
    val hasFileCopy: Boolean,
    val hasFolderCopy: Boolean,
    val hasOpenReadWriteCloseCapability: Boolean,
    val hasLegacyWatchCapability: Boolean,
    val hasDiffCapability: Boolean,
    val hasFileChangeCapability: Boolean,
)

/**
 * File overwrite options.
 * Options for controlling file overwrite behavior during write operations.
 *
 * @property overwrite Whether to overwrite existing files
 */
data class FileOverwriteOptions(
    val overwrite: Boolean,
)

/**
 * File delete options.
 * Options for controlling file deletion behavior.
 *
 * @property recursive Whether to delete directories recursively
 * @property useTrash Whether to move files to trash instead of permanent deletion
 */
data class FileDeleteOptions(
    val recursive: Boolean,
    val useTrash: Boolean,
)

/**
 * File change data.
 * Represents a change event in the file system.
 *
 * @property type The type of change: 1 for ADDED, 2 for UPDATED, 3 for DELETED
 * @property resource The resource that was changed, represented as a map of properties
 */
data class FileChangeDto(
    val type: Int, // 1: ADDED, 2: UPDATED, 3: DELETED
    val resource: Map<String, Any?>,
)

/**
 * Markdown string interface.
 * Represents a string that can contain markdown formatting.
 */
interface MarkdownString {
    val value: String
    val isTrusted: Boolean
}

/**
 * Main thread file system service interface.
 * Corresponds to the MainThreadFileSystemShape interface in VSCode.
 * Provides an abstraction layer for file system operations that can be executed from the main thread.
 */
interface MainThreadFileSystemShape : Disposable {
    /**
     * Registers a file system provider with the given handle and scheme.
     *
     * @param handle A unique identifier for the provider
     * @param scheme The URI scheme this provider handles (e.g., "file", "ftp", etc.)
     */
    fun registerFileSystemProvider(handle: Int, scheme: String)

    /**
     * Unregisters a file system provider.
     *
     * @param handle The handle of the provider to unregister
     */
    fun unregisterProvider(handle: Int)

    /**
     * Gets file status information for the specified resource.
     *
     * @param resource The URI of the file or directory to get information about
     * @return FileStat object containing file metadata
     */
    fun stat(resource: URI): FileStat

    /**
     * Reads directory contents.
     * Returns a list of entries in the specified directory.
     *
     * @param resource The URI of the directory to read
     * @return List of pairs, where each pair contains (filename, fileType)
     */
    fun readdir(resource: URI): List<Pair<String, String>>

    /**
     * Reads file content.
     * Returns the raw bytes of the specified file.
     *
     * @param uri The URI of the file to read
     * @return Byte array containing the file content
     */
    fun readFile(uri: URI): ByteArray

    /**
     * Writes file content.
     * Writes the provided content to the specified file.
     *
     * @param uri The URI of the file to write
     * @param content The content to write as a byte array
     * @param overwrite Whether to overwrite if the file already exists
     * @return The written content as a byte array
     */
    fun writeFile(uri: URI, content: ByteArray, overwrite: Boolean): ByteArray

    /**
     * Renames a file or directory.
     * Moves a file or directory from source to target location.
     *
     * @param source The URI of the source file/directory
     * @param target The URI of the target location
     * @param options Additional options for the rename operation
     */
    fun rename(source: URI, target: URI, options: Map<String, Any>)

    /**
     * Copies a file or directory.
     * Creates a copy of the source at the target location.
     *
     * @param source The URI of the source file/directory
     * @param target The URI of the target location
     * @param options Additional options for the copy operation
     */
    fun copy(source: URI, target: URI, options: Map<String, Any>)

    /**
     * Creates a directory.
     * Creates the specified directory and any necessary parent directories.
     *
     * @param uri The URI of the directory to create
     */
    fun mkdir(uri: URI)

    /**
     * Deletes a file or directory.
     * Removes the specified file or directory from the file system.
     *
     * @param uri The URI of the file/directory to delete
     * @param options Additional options for the delete operation
     */
    fun delete(uri: URI, options: Map<String, Any>)

    /**
     * Ensures activation.
     * Ensures that the file system provider for the given scheme is activated.
     *
     * @param scheme The URI scheme to ensure is activated
     */
    fun ensureActivation(scheme: String)

    /**
     * Listens for file system changes.
     * Processes file system change notifications from providers.
     *
     * @param handle The handle of the provider sending the change notification
     * @param resources List of file changes to process
     */
    fun onFileSystemChange(handle: Int, resources: List<FileChangeDto>)
}

/**
 * Main thread file system service implementation.
 * Provides implementation of file system related functionality for the IDEA platform.
 * This class implements the MainThreadFileSystemShape interface and provides
 * concrete implementations for all file system operations.
 */
class MainThreadFileSystem : MainThreadFileSystemShape {
    private val logger = Logger.getInstance(MainThreadFileSystem::class.java)

    // Registered file system providers mapped by their handles
    private val providers = ConcurrentHashMap<Int, String>()

    /**
     * Registers a file system provider with the given handle and scheme.
     * This method stores the provider information for later use.
     *
     * @param handle A unique identifier for the provider
     * @param scheme The URI scheme this provider handles
     */
    override fun registerFileSystemProvider(handle: Int, scheme: String) {
        logger.info("Registering file system provider: handle=$handle, scheme=$scheme")

        try {
            // Store provider information
            providers[handle] = scheme

            // Actual implementation would need to integrate with IDEA's VFS
            // based on the scheme
        } catch (e: Exception) {
            logger.error("Failed to register file system provider: $e")
            throw e
        }
    }

    /**
     * Unregisters a file system provider.
     * Removes the provider associated with the given handle.
     *
     * @param handle The handle of the provider to unregister
     */
    override fun unregisterProvider(handle: Int) {
        logger.info("Unregistering file system provider: handle=$handle")

        try {
            // Remove provider information
            providers.remove(handle)

            // Actual implementation would need to unregister the corresponding file system provider
        } catch (e: Exception) {
            logger.error("Failed to unregister file system provider: $e")
            throw e
        }
    }

    /**
     * Gets file status information for the specified resource.
     * Retrieves metadata about a file or directory including type, timestamps, and size.
     *
     * @param resource The URI of the file or directory to get information about
     * @return FileStat object containing file metadata
     */
    override fun stat(resource: URI): FileStat {
        logger.info("Getting file status information: $resource")

        try {
            val path = getPathFromUriComponents(resource)
            val file = File(path)

            if (!file.exists()) {
                throw Exception("File does not exist: $path")
            }

            val type = when {
                file.isDirectory -> FileType.DIRECTORY
                Files.isSymbolicLink(Paths.get(file.toURI())) -> FileType.SYMBOLIC_LINK
                else -> FileType.FILE
            }

            val ctime = file.lastModified()
            val mtime = file.lastModified()
            val size = file.length()

            return FileStat(type, ctime, mtime, size)
        } catch (e: Exception) {
            logger.error("Failed to get file status information: $e")
            throw e
        }
    }

    /**
     * Reads directory contents.
     * Returns a list of all entries in the specified directory.
     *
     * @param resource The URI of the directory to read
     * @return List of pairs, where each pair contains (filename, fileType)
     */
    override fun readdir(resource: URI): List<Pair<String, String>> {
        logger.info("Reading directory contents: $resource")

        try {
            val path = getPathFromUriComponents(resource)
            val file = File(path)

            if (!file.exists() || !file.isDirectory) {
                throw Exception("Directory does not exist or is not a directory: $path")
            }

            // Read directory contents
            return file.listFiles()?.map {
                Pair(it.name, if (it.isDirectory) FileType.DIRECTORY.ordinal.toString() else FileType.FILE.ordinal.toString())
            } ?: emptyList()
        } catch (e: Exception) {
            logger.error("Failed to read directory contents: $e")
            throw e
        }
    }

    /**
     * Reads file content.
     * Returns the raw bytes of the specified file.
     *
     * @param uri The URI of the file to read
     * @return Byte array containing the file content
     */
    override fun readFile(uri: URI): ByteArray {
        logger.info("Reading file content: $uri")

        try {
            val path = getPathFromUriComponents(uri)
            val file = File(path)

            if (!file.exists() || file.isDirectory) {
                throw Exception("File does not exist or is a directory: $path")
            }

            // Read file content
            return file.readBytes()
        } catch (e: Exception) {
            logger.error("Failed to read file content: $e")
            throw e
        }
    }

    /**
     * Writes file content.
     * Writes the provided content to the specified file.
     *
     * @param uri The URI of the file to write
     * @param content The content to write as a byte array
     * @param overwrite Whether to overwrite if the file already exists
     * @return The written content as a byte array
     */
    override fun writeFile(uri: URI, content: ByteArray, overwrite: Boolean): ByteArray {
        logger.info("Writing file content: $uri, content size: ${content.size} bytes")

        try {
            val path = getPathFromUriComponents(uri)
            val file = File(path)

            // Ensure parent directory exists
            file.parentFile?.mkdirs()

            // Write file content
            file.writeBytes(content)
            return content
        } catch (e: Exception) {
            logger.error("Failed to write file content: $e")
            throw e
        }
    }

    /**
     * Renames a file or directory.
     * Moves a file or directory from source to target location.
     *
     * @param source The URI of the source file/directory
     * @param target The URI of the target location
     * @param options Additional options for the rename operation
     */
    override fun rename(source: URI, target: URI, options: Map<String, Any>) {
        logger.info("Renaming: $source -> $target")

        try {
            val sourcePath = getPathFromUriComponents(source)
            val targetPath = getPathFromUriComponents(target)
            val overwrite = options["overwrite"] as? Boolean ?: false

            val sourceFile = File(sourcePath)
            val targetFile = File(targetPath)

            if (!sourceFile.exists()) {
                throw Exception("Source file does not exist: $sourcePath")
            }

            if (targetFile.exists() && !overwrite) {
                throw Exception("Target file already exists and overwrite is not allowed: $targetPath")
            }

            // Ensure parent directory exists
            targetFile.parentFile?.mkdirs()

            // Perform rename operation
            if (!sourceFile.renameTo(targetFile)) {
                // If simple rename fails, try copy then delete
                Files.move(
                    Paths.get(sourcePath),
                    Paths.get(targetPath),
                    if (overwrite) StandardCopyOption.REPLACE_EXISTING else StandardCopyOption.ATOMIC_MOVE,
                )
            }
        } catch (e: Exception) {
            logger.error("Rename operation failed: $e")
            throw e
        }
    }

    /**
     * Copies a file or directory.
     * Creates a copy of the source at the target location.
     *
     * @param source The URI of the source file/directory
     * @param target The URI of the target location
     * @param options Additional options for the copy operation
     */
    override fun copy(source: URI, target: URI, options: Map<String, Any>) {
        logger.info("Copying: $source -> $target")

        try {
            val sourcePath = getPathFromUriComponents(source)
            val targetPath = getPathFromUriComponents(target)
            val overwrite = options["overwrite"] as? Boolean ?: false

            val sourceFile = File(sourcePath)
            val targetFile = File(targetPath)

            if (!sourceFile.exists()) {
                throw Exception("Source file does not exist: $sourcePath")
            }

            if (targetFile.exists() && !overwrite) {
                throw Exception("Target file already exists and overwrite is not allowed: $targetPath")
            }

            // Ensure parent directory exists
            targetFile.parentFile?.mkdirs()

            if (sourceFile.isDirectory) {
                // Copy directory recursively
                sourceFile.copyRecursively(targetFile, overwrite)
            } else {
                // Copy file
                Files.copy(
                    Paths.get(sourcePath),
                    Paths.get(targetPath),
                    if (overwrite) StandardCopyOption.REPLACE_EXISTING else StandardCopyOption.COPY_ATTRIBUTES,
                )
            }
        } catch (e: Exception) {
            logger.error("Copy operation failed: $e")
            throw e
        }
    }

    /**
     * Creates a directory.
     * Creates the specified directory and any necessary parent directories.
     *
     * @param uri The URI of the directory to create
     */
    override fun mkdir(uri: URI) {
        logger.info("Creating directory: $uri")

        try {
            val path = getPathFromUriComponents(uri)
            val file = File(path)

            if (file.exists()) {
                throw Exception("File or directory already exists: $path")
            }

            // Create directory
            if (!file.mkdirs()) {
                throw Exception("Failed to create directory: $path")
            }
        } catch (e: Exception) {
            logger.error("Failed to create directory: $e")
            throw e
        }
    }

    /**
     * Deletes a file or directory.
     * Removes the specified file or directory from the file system.
     *
     * @param uri The URI of the file/directory to delete
     * @param options Additional options for the delete operation
     */
    override fun delete(uri: URI, options: Map<String, Any>) {
        logger.info("Deleting: $uri, options: $options")

        try {
            val path = getPathFromUriComponents(uri)
            val file = File(path)
            val recursive = options["recursive"] as? Boolean ?: false
            val useTrash = options["useTrash"] as? Boolean ?: false

            if (!file.exists()) {
                // If file doesn't exist, consider deletion successful
                return
            }

            if (useTrash) {
                // TODO: Implement trash deletion based on platform
                // Currently performs direct deletion, should move to trash in actual implementation
                logger.warn("Trash deletion not implemented, performing direct deletion")
            }

            if (file.isDirectory && recursive) {
                // Recursively delete directory
                file.deleteRecursively()
            } else if (file.isDirectory && !recursive) {
                throw Exception("Cannot delete non-empty directory unless recursive=true: $path")
            } else {
                // Delete file
                file.delete()
            }
        } catch (e: Exception) {
            logger.error("Delete operation failed: $e")
            throw e
        }
    }

    /**
     * Ensures activation.
     * Ensures that the file system provider for the given scheme is activated.
     *
     * @param scheme The URI scheme to ensure is activated
     */
    override fun ensureActivation(scheme: String) {
        logger.info("Ensuring activation: $scheme")

        try {
            // This should handle file system activation
            // Actual implementation may need to notify IDEA's VFS to refresh
        } catch (e: Exception) {
            logger.error("Failed to ensure activation: $e")
            throw e
        }
    }

    /**
     * Listens for file system changes.
     * Processes file system change notifications from providers.
     *
     * @param handle The handle of the provider sending the change notification
     * @param resources List of file changes to process
     */
    override fun onFileSystemChange(handle: Int, resources: List<FileChangeDto>) {
        logger.info("File system change notification: handle=$handle, resources=${resources.joinToString { it.resource.toString() }}")

        try {
            // This should handle file system change notifications
            // Actual implementation may need to notify IDEA's VFS to refresh
        } catch (e: Exception) {
            logger.error("Failed to process file system change notification: $e")
            throw e
        }
    }

    /**
     * Gets file system path from URI components.
     * Converts a URI to a local file system path.
     *
     * @param uri The URI to convert
     * @return The corresponding file system path
     */
    private fun getPathFromUriComponents(uri: URI): String {
        return File(uri).path
    }

    /**
     * Disposes of resources.
     * Cleans up resources when this service is no longer needed.
     */
    override fun dispose() {
        logger.info("Disposing MainThreadFileSystem resources")
        providers.clear()
    }
}
