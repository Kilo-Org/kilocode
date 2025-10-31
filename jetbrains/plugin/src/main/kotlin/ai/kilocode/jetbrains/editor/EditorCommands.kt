// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

package ai.kilocode.jetbrains.editor

import ai.kilocode.jetbrains.commands.CommandRegistry
import ai.kilocode.jetbrains.commands.ICommand
import ai.kilocode.jetbrains.util.URI
import ai.kilocode.jetbrains.util.URIComponents
import com.intellij.diff.DiffContentFactory
import com.intellij.diff.contents.DiffContent
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.LocalFileSystem
import java.io.File

/**
 * Registers commands related to editor API operations
 * Registers both single-file diff and multi-file diff commands
 *
 * @param project The current IntelliJ project
 * @param registry The command registry to register commands with
 */
fun registerOpenEditorAPICommands(project: Project, registry: CommandRegistry) {
    registry.registerCommand(
        object : ICommand {
            override fun getId(): String {
                return "_workbench.diff"
            }
            override fun getMethod(): String {
                return "workbench_diff"
            }

            override fun handler(): Any {
                return OpenEditorAPICommands(project)
            }

            override fun returns(): String? {
                return "void"
            }
        },
    )

    // Register the multi-diff command
    registerMultiDiffCommands(project, registry)
}

/**
 * Handles editor API commands for operations like opening diff editors
 */
class OpenEditorAPICommands(val project: Project) {
    private val logger = Logger.getInstance(OpenEditorAPICommands::class.java)

    /**
     * Opens a diff editor to compare two files
     *
     * @param left Map containing URI components for the left file
     * @param right Map containing URI components for the right file
     * @param title Optional title for the diff editor
     * @param columnOrOptions Optional column or options for the diff editor
     * @return null after operation completes
     */
    suspend fun workbench_diff(left: Map<String, Any?>, right: Map<String, Any?>, title: String?, columnOrOptions: Any?): Any? {
        val rightURI = createURI(right)
        val leftURI = createURI(left)
        logger.info("Opening diff: ${rightURI.path}")
        val content1 = createContent(left, project)
        val content2 = createContent(right, project)
        if (content1 != null && content2 != null) {
            project.getService(EditorAndDocManager::class.java).openDiffEditor(leftURI, rightURI, title ?: "File Comparison")
        }
        logger.info("Opening diff completed: ${rightURI.path}")
        return null
    }

    /**
     * Creates a DiffContent object from URI components
     *
     * @param uri Map containing URI components
     * @param project The current IntelliJ project
     * @return DiffContent object or null if creation fails
     */
    fun createContent(uri: Map<String, Any?>, project: Project): DiffContent? {
        val path = uri["path"]
        val scheme = uri["scheme"]
        val query = uri["query"]
        val fragment = uri["fragment"]
        if (scheme != null) {
            val contentFactory = DiffContentFactory.getInstance()
            if (scheme == "file") {
                val vfs = LocalFileSystem.getInstance()
                val fileIO = File(path as String)
                if (!fileIO.exists()) {
                    fileIO.createNewFile()
                    vfs.refreshIoFiles(listOf(fileIO.parentFile))
                }

                val file = vfs.refreshAndFindFileByPath(path as String) ?: run {
                    logger.warn("File not found: $path")
                    return null
                }
                return contentFactory.create(project, file)
            } else if (scheme == "cline-diff") {
                val string = if (query != null) {
                    val bytes = java.util.Base64.getDecoder().decode(query as String)
                    String(bytes)
                } else {
                    ""
                }
                val content = contentFactory.create(project, string)
                return content
            }
            return null
        } else {
            return null
        }
    }
}

/**
 * Creates a URI object from a map of URI components
 *
 * @param map Map containing URI components (scheme, authority, path, query, fragment)
 * @return URI object constructed from the components
 */
fun createURI(map: Map<String, Any?>): URI {
    val authority = if (map["authority"] != null) map["authority"] as String else ""
    val query = if (map["query"] != null) map["query"] as String else ""
    val fragment = if (map["fragment"] != null) map["fragment"] as String else ""

    val uriComponents = object : URIComponents {
        override val scheme: String = map["scheme"] as String
        override val authority: String = authority
        override val path: String = map["path"] as String
        override val query: String = query
        override val fragment: String = fragment
    }
    return URI.from(uriComponents)
}
