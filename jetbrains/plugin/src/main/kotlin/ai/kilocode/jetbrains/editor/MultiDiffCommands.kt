// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

package ai.kilocode.jetbrains.editor

import ai.kilocode.jetbrains.commands.CommandRegistry
import ai.kilocode.jetbrains.commands.ICommand
import ai.kilocode.jetbrains.util.URI
import com.intellij.diff.DiffContentFactory
import com.intellij.diff.chains.DiffRequestChain
import com.intellij.diff.chains.SimpleDiffRequestChain
import com.intellij.diff.contents.DiffContent
import com.intellij.diff.editor.ChainDiffVirtualFile
import com.intellij.diff.editor.DiffEditorTabFilesManager
import com.intellij.diff.requests.SimpleDiffRequest
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.LocalFileSystem
import java.io.File

/**
 * Registers commands related to multi-file diff operations
 * Implements the "vscode.changes" command for showing multiple file diffs
 *
 * @param project The current IntelliJ project
 * @param registry The command registry to register commands with
 */
fun registerMultiDiffCommands(project: Project, registry: CommandRegistry) {
    val multiDiffCommand = object : ICommand {
        override fun getId(): String {
            return "_workbench.changes"
        }

        override fun getMethod(): String {
            return "vscode_changes"
        }

        override fun handler(): Any {
            return MultiDiffCommands(project)
        }

        override fun returns(): String? {
            return "void"
        }
    }

    // Register the primary command
    registry.registerCommand(multiDiffCommand)

    // Register an alias for VSCode compatibility
    registry.registerCommandAlias("_workbench.changes", "vscode.changes")
}

/**
 * Handles multi-file diff commands for operations like showing changes across multiple files
 */
class MultiDiffCommands(val project: Project) {
    private val logger = Logger.getInstance(MultiDiffCommands::class.java)

    /**
     * Shows a multi-file diff view similar to VSCode's "vscode.changes" command
     *
     * @param title The title for the diff view
     * @param changes List of change triplets, each containing [originalFile, beforeContent, afterContent]
     * @return null after operation completes
     */
    suspend fun vscode_changes(title: String, changes: List<List<Map<String, Any?>>>): Any? {
        logger.info("Opening multi-file diff view: $title with ${changes.size} changes")

        if (changes.isEmpty()) {
            logger.warn("No changes provided for multi-diff view")
            return null
        }

        try {
            val diffRequests = mutableListOf<SimpleDiffRequest>()

            // Process each change triplet
            for ((index, changeTriplet) in changes.withIndex()) {
                if (changeTriplet.size != 3) {
                    logger.warn("Invalid change triplet at index $index: expected 3 elements, got ${changeTriplet.size}")
                    continue
                }

                val originalFileUri = ai.kilocode.jetbrains.editor.createURI(changeTriplet[0])
                val beforeContentUri = ai.kilocode.jetbrains.editor.createURI(changeTriplet[1])
                val afterContentUri = ai.kilocode.jetbrains.editor.createURI(changeTriplet[2])

                logger.info("Processing change for file: ${originalFileUri.path}")

                val beforeContent = createContent(beforeContentUri, project)
                val afterContent = createContent(afterContentUri, project, beforeContent?.contentType)

                if (beforeContent != null && afterContent != null) {
                    val fileName = File(originalFileUri.path).name
                    val diffTitle = "$fileName: Changes"

                    val diffRequest = SimpleDiffRequest(
                        diffTitle,
                        beforeContent,
                        afterContent,
                        "Original",
                        "Modified",
                    )

                    diffRequests.add(diffRequest)
                } else {
                    logger.warn("Failed to create diff content for file: ${originalFileUri.path}")
                }
            }

            if (diffRequests.isNotEmpty()) {
                ApplicationManager.getApplication().invokeAndWait {
                    showMultiDiffView(title, diffRequests)
                }
            } else {
                logger.warn("No valid diff requests created")
            }
        } catch (e: Exception) {
            logger.error("Error creating multi-file diff view", e)
        }

        logger.info("Multi-file diff view operation completed")
        return null
    }

    /**
     * Shows the multi-diff view using IntelliJ's diff editor
     */
    private fun showMultiDiffView(title: String, diffRequests: List<SimpleDiffRequest>) {
        val diffEditorTabFilesManager = DiffEditorTabFilesManager.getInstance(project)

        try {
            if (diffRequests.size == 1) {
                // For single file, show regular diff
                val requestChain: DiffRequestChain = SimpleDiffRequestChain(diffRequests[0])
                val diffFile = ChainDiffVirtualFile(requestChain, title)
                diffEditorTabFilesManager.showDiffFile(diffFile, true)
                logger.info("Opened single-file diff view: $title")
            } else {
                // For multiple files, create a chain of diff requests
                val requestChain: DiffRequestChain = SimpleDiffRequestChain(diffRequests)
                val diffFile = ChainDiffVirtualFile(requestChain, title)
                diffEditorTabFilesManager.showDiffFile(diffFile, true)
                logger.info("Opened multi-file diff view: $title with ${diffRequests.size} files")
            }
        } catch (e: Exception) {
            logger.error("Failed to show diff view: $title", e)
            throw e
        }
    }

    /**
     * Creates a DiffContent object from URI components
     *
     * @param uri URI object containing the content location
     * @param project The current IntelliJ project
     * @param preferredFileType Optional file type to use for content
     * @return DiffContent object or null if creation fails
     */
    private fun createContent(uri: URI, project: Project, preferredFileType: com.intellij.openapi.fileTypes.FileType? = null): DiffContent? {
        val path = uri.path
        val scheme = uri.scheme
        val query = uri.query

        if (scheme.isNullOrEmpty()) {
            logger.warn("URI scheme is null or empty for path: $path")
            return null
        }

        val contentFactory = DiffContentFactory.getInstance()

        return try {
            when (scheme) {
                "file" -> {
                    val vfs = LocalFileSystem.getInstance()
                    val fileIO = File(path)

                    if (!fileIO.exists()) {
                        logger.debug("File does not exist, creating empty content: $path")
                        // Create empty content for non-existent files (new files)
                        return contentFactory.create(project, "", preferredFileType)
                    }

                    val file = vfs.refreshAndFindFileByPath(path)
                    if (file == null) {
                        logger.warn("Virtual file not found: $path")
                        return contentFactory.create(project, "", preferredFileType)
                    }

                    contentFactory.create(project, file)
                }

                "cline-diff" -> {
                    val content = if (!query.isNullOrEmpty()) {
                        try {
                            val bytes = java.util.Base64.getDecoder().decode(query)
                            String(bytes, Charsets.UTF_8)
                        } catch (e: IllegalArgumentException) {
                            logger.warn("Failed to decode base64 content for path: $path", e)
                            ""
                        }
                    } else {
                        ""
                    }

                    contentFactory.create(project, content, preferredFileType)
                }

                else -> {
                    logger.warn("Unsupported URI scheme: $scheme for path: $path")
                    null
                }
            }
        } catch (e: Exception) {
            logger.error("Error creating diff content for URI: $uri", e)
            null
        }
    }
}
