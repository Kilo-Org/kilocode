// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

package ai.kilocode.jetbrains.editor

import ai.kilocode.jetbrains.util.URI


data class ModelAddedData(
    val uri: URI,
    var versionId: Int,
    var lines: List<String>,
    val EOL: String,
    var languageId: String,
    var isDirty: Boolean,
    var encoding: String
)

data class Selection(
    val selectionStartLineNumber: Int,
    val selectionStartColumn: Int,
    val positionLineNumber: Int,
    val positionColumn: Int
)

data class Range(
    val startLineNumber: Int,
    val startColumn: Int,
    val endLineNumber: Int,
    val endColumn: Int
)

data class ResolvedTextEditorConfiguration(
    val tabSize: Int = 4,
    val indentSize: Int = 4,
    val originalIndentSize: Int = 4,
    val insertSpaces: Boolean = true,
    val cursorStyle: Int = 1,
    val lineNumbers: Int = 1
)



data class TextEditorAddData(
    val id: String,
    val documentUri: URI,
    var options: ResolvedTextEditorConfiguration,
    var selections: List<Selection>,
    var visibleRanges: List<Range>,
    var editorPosition: Int?
)

data class ModelContentChange(
    val range: Range,
    val rangeOffset: Int,
    val rangeLength: Int,
    val text: String
)

data class ModelChangedEvent(
    val changes: List<ModelContentChange>,
    val eol: String,
    val versionId: Int,
    val isUndoing: Boolean,
    val isRedoing: Boolean,
    val isDirty: Boolean
)

data class SelectionChangeEvent(
    val selections: List<Selection>,
    val source: String?
)

data class EditorPropertiesChangeData(
    val options: ResolvedTextEditorConfiguration?,
    val selections: SelectionChangeEvent?,
    val visibleRanges: List<Range>?
)

data class DocumentsAndEditorsDelta(
    val removedDocuments: List<URI>?,
    val addedDocuments: List<ModelAddedData>?,
    val removedEditors: List<String>?,
    val addedEditors: List<TextEditorAddData>?,
    val newActiveEditor: String?
) {
    fun isEmpty(): Boolean {
        var isEmpty = true
        if (!removedDocuments.isNullOrEmpty()) {
            isEmpty = false
        }
        if (!addedDocuments.isNullOrEmpty()) {
            isEmpty = false
        }
        if (!removedEditors.isNullOrEmpty()) {
            isEmpty = false
        }
        if (!addedEditors.isNullOrEmpty()) {
            isEmpty = false
        }
        if (!newActiveEditor.isNullOrEmpty()) {
            isEmpty = false
        }
        return isEmpty
    }
}


data class TextEditorChange(
    val originalStartLineNumber : Int,
    val originalEndLineNumberExclusive : Int,
    val modifiedStartLineNumber : Int,
    val modifiedEndLineNumberExclusive : Int
)


data class TextEditorDiffInformation(
    val documentVersion: Int,
    val original: URI?,
    val modified: URI,
    val changes: List<TextEditorChange>
)

enum class EditorGroupColumn(val value: Int) {
    active(-1),
    beside(-2),
    one(1),
    two(2),
    three(3),
    four(4),
    five(5),
    six(6),
    seven(7),
    eight(8),
    nine(9);

    val groupIndex : Int
        get() {
            return when (this) {
                active -> -1
                beside -> -2
                else -> this.value - 1
            }
        }

    companion object {
        fun fromValue(value: Int): EditorGroupColumn {
            return when (value) {
                -2 -> beside
                -1 -> active
                1 -> one
                2 -> two
                3 -> three
                4 -> four
                5 -> five
                6 -> six
                7 -> seven
                8 -> eight
                9 -> nine
                else -> {active}
            }
        }
    }
}