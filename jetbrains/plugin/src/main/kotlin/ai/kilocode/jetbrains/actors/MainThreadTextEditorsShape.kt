// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

package ai.kilocode.jetbrains.actors

import ai.kilocode.jetbrains.editor.EditorAndDocManager
import ai.kilocode.jetbrains.editor.Range
import ai.kilocode.jetbrains.editor.createURI
import com.intellij.openapi.Disposable
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.LocalFileSystem
import java.io.File

/**
 * Main thread text editor interface
 */
interface MainThreadTextEditorsShape : Disposable {
    /**
     * Try to show text document
     * @param resource Resource URI
     * @param options Display options
     * @return Editor ID or null
     */
    suspend fun tryShowTextDocument(resource: Map<String, Any?>, options: Any?): Any?

    /**
     * Register text editor decoration type
     * @param extensionId Extension ID
     * @param key Decoration type key
     * @param options Decoration rendering options
     */
    fun registerTextEditorDecorationType(extensionId: Map<String, String>, key: String, options: Any)

    /**
     * Remove text editor decoration type
     * @param key Decoration type key
     */
    fun removeTextEditorDecorationType(key: String)

    /**
     * Try to show editor
     * @param id Editor ID
     * @param position Position
     * @return Operation result
     */
    fun tryShowEditor(id: String, position: Any?): Any

    /**
     * Try to hide editor
     * @param id Editor ID
     * @return Operation result
     */
    fun tryHideEditor(id: String): Any

    /**
     * Try to set options
     * @param id Editor ID
     * @param options Configuration updates
     * @return Operation result
     */
    fun trySetOptions(id: String, options: Any): Any

    /**
     * Try to set decorations
     * @param id Editor ID
     * @param key Decoration type key
     * @param ranges Decoration ranges
     * @return Operation result
     */
    fun trySetDecorations(id: String, key: String, ranges: List<Any>): Any

    /**
     * Try to quickly set decorations
     * @param id Editor ID
     * @param key Decoration type key
     * @param ranges Decoration ranges array
     * @return Operation result
     */
    fun trySetDecorationsFast(id: String, key: String, ranges: List<Any>): Any

    /**
     * Try to reveal range
     * @param id Editor ID
     * @param range Display range
     * @param revealType Display type
     * @return Operation result
     */
    fun tryRevealRange(id: String, range: Map<String, Any?>, revealType: Int): Any

    /**
     * Try to set selections
     * @param id Editor ID
     * @param selections Selections array
     * @return Operation result
     */
    fun trySetSelections(id: String, selections: List<Any>): Any

    /**
     * Try to apply edits
     * @param id Editor ID
     * @param modelVersionId Model version ID
     * @param edits Edit operations
     * @param opts Apply options
     * @return Whether successful
     */
    fun tryApplyEdits(id: String, modelVersionId: Int, edits: List<Any>, opts: Any?): Boolean

    /**
     * Try to insert snippet
     * @param id Editor ID
     * @param modelVersionId Model version ID
     * @param template Code snippet template
     * @param selections Selection ranges
     * @param opts Undo options
     * @return Whether successful
     */
    fun tryInsertSnippet(id: String, modelVersionId: Int, template: String, selections: List<Any>, opts: Any?): Boolean

    /**
     * Get diff information
     * @param id Editor ID
     * @return Diff information
     */
    fun getDiffInformation(id: String): Any?
}

/**
 * Main thread text editor implementation
 */
class MainThreadTextEditors(var project: Project) : MainThreadTextEditorsShape {
    private val logger = Logger.getInstance(MainThreadTextEditors::class.java)

    override suspend fun tryShowTextDocument(resource: Map<String, Any?>, options: Any?): Any? {
        logger.info("Trying to show text document: resource=$resource, options=$options")
        val path = resource["path"] as String? ?: ""

        val vfs = LocalFileSystem.getInstance()
        vfs.refreshIoFiles(listOf(File(path)))
        val resourceURI = createURI(resource)
        val editorHandle = project.getService(EditorAndDocManager::class.java).openEditor(resourceURI)
        logger.info("Trying to show text document: resource=$resource execution completed")
        return editorHandle.id
    }

    override fun registerTextEditorDecorationType(extensionId: Map<String, String>, key: String, options: Any) {
        logger.info("Registering text editor decoration type: extensionId=$extensionId, key=$key, options=$options")
    }

    override fun removeTextEditorDecorationType(key: String) {
        logger.info("Removing text editor decoration type: $key")
    }

    override fun tryShowEditor(id: String, position: Any?): Any {
        logger.info("Trying to show editor: id=$id, position=$position")
        return Unit
    }

    override fun tryHideEditor(id: String): Any {
        logger.info("Trying to hide editor: $id")
        return Unit
    }

    override fun trySetOptions(id: String, options: Any): Any {
        logger.info("Try to set options: id=$id, options=$options")
        return Unit
    }

    override fun trySetDecorations(id: String, key: String, ranges: List<Any>): Any {
        logger.info("Try to set decorations: id=$id, key=$key, ranges=${ranges.size}")
        return Unit
    }

    override fun trySetDecorationsFast(id: String, key: String, ranges: List<Any>): Any {
        logger.info("Try to quickly set decorations: id=$id, key=$key, ranges=${ranges.size}")
        return Unit
    }

    override fun tryRevealRange(id: String, range: Map<String, Any?>, revealType: Int): Any {
        logger.info("Try to reveal range: id=$id, range=$range, revealType=$revealType")
        val handle = project.getService(EditorAndDocManager::class.java).getEditorHandleById(id)
        handle?.let {
            val rang = createRanges(range)
            handle.revealRange(rang)
        }
        return Unit
    }

    private fun createRanges(range: Map<String, Any?>): Range {
        val startLineNumber = (range["startLineNumber"] as? Number)?.toInt() ?: 0
        val startColumn = (range["startColumn"] as? Number)?.toInt() ?: 0
        val endLineNumber = (range["endLineNumber"] as? Number)?.toInt() ?: startLineNumber
        val endColumn = (range["endColumn"] as? Number)?.toInt() ?: startColumn
        return Range(startLineNumber, startColumn, endLineNumber, endColumn)
    }

    override fun trySetSelections(id: String, selections: List<Any>): Any {
        logger.info("Try to set selections: id=$id, selections=$selections")
        return Unit
    }

    override fun tryApplyEdits(id: String, modelVersionId: Int, edits: List<Any>, opts: Any?): Boolean {
        logger.info("Try to apply edits: id=$id, modelVersionId=$modelVersionId, edits=$edits, opts=$opts")
        return true
    }

    override fun tryInsertSnippet(id: String, modelVersionId: Int, template: String, selections: List<Any>, opts: Any?): Boolean {
        logger.info("Try to insert snippet: id=$id, modelVersionId=$modelVersionId, template=$template, selections=$selections, opts=$opts")
        return true
    }

    override fun getDiffInformation(id: String): Any? {
        logger.info("Get diff information: $id")
        return null
    }

    override fun dispose() {
        logger.info("Dispose MainThreadTextEditors")
    }
}
