// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

package ai.kilocode.jetbrains.editor

import ai.kilocode.jetbrains.util.URI

/**
 * Tab operation type, corresponding to VSCode's TabModelOperationKind
 * Represents different kinds of operations that can be performed on tabs
 */
enum class TabModelOperationKind(val value: Int) {
    TAB_OPEN(0),
    TAB_CLOSE(1),
    TAB_UPDATE(2),
    TAB_MOVE(3),
}

/**
 * Tab input type, corresponding to VSCode's TabInputKind
 * Represents different types of content that can be displayed in a tab
 */
enum class TabInputKind(val value: Int) {
    UNKNOWN_INPUT(0),
    TEXT_INPUT(1),
    TEXT_DIFF_INPUT(2),
    TEXT_MERGE_INPUT(3),
    NOTEBOOK_INPUT(4),
    NOTEBOOK_DIFF_INPUT(5),
    CUSTOM_EDITOR_INPUT(6),
    WEBVIEW_EDITOR_INPUT(7),
    TERMINAL_EDITOR_INPUT(8),
    INTERACTIVE_EDITOR_INPUT(9),
    CHAT_EDITOR_INPUT(10),
    MULTI_DIFF_EDITOR_INPUT(11),
}

/**
 * Tab operation, corresponding to VSCode's TabOperation
 * Represents an operation performed on a tab (open, close, update, move)
 */
data class TabOperation(
    val groupId: Int,
    val index: Int,
    val tabDto: EditorTabDto,
    val kind: Int,
    val oldIndex: Int?,
)

/**
 * Tab data, corresponding to VSCode's IEditorTabDto
 * Contains all information about a specific editor tab
 */
data class EditorTabDto(
    val id: String,
    val label: String,
    val input: TabInputBase,
    var isActive: Boolean,
    var isPinned: Boolean,
    var isPreview: Boolean,
    var isDirty: Boolean,
)

/**
 * Tab group data, corresponding to VSCode's IEditorTabGroupDto
 * Represents a group of editor tabs that are displayed together
 */
data class EditorTabGroupDto(
    val groupId: Int,
    var isActive: Boolean,
    var viewColumn: Int,
    var tabs: List<EditorTabDto>,
)

/**
 * Base class for all tab input types.
 * Stores the kind of input for the tab.
 */
open class TabInputBase(
    var kind: Int = TabInputKind.UNKNOWN_INPUT.value,
)

/**
 * Tab input, corresponding to VSCode's IEditorTabInput
 * Represents a text editor input for a tab
 */
data class EditorTabInput(
    var uri: URI?,
    var label: String?,
    var languageId: String?,
) : TabInputBase(TabInputKind.TEXT_INPUT.value)

/**
 * Tab input, corresponding to VSCode's IWebviewEditorTabInput
 * Represents a webview editor input for a tab
 */
/**
 * Represents a webview editor input for a tab.
 * Used for tabs displaying webview content.
 */
class WebviewEditorTabInput(var viewType: String?) : TabInputBase(TabInputKind.WEBVIEW_EDITOR_INPUT.value)

/**
 * Tab input, corresponding to VSCode's ICustomEditorTabInput
 * Represents a custom editor input for a tab
 */
/**
 * Represents a custom editor input for a tab.
 * Used for tabs with custom editor implementations.
 */
class CustomEditorTabInput(
    var uri: URI?,
    var viewType: String?,
) : TabInputBase(TabInputKind.CUSTOM_EDITOR_INPUT.value)

/**
 * Tab input, corresponding to VSCode's ITerminalEditorTabInput
 * Represents a terminal editor input for a tab
 */
/**
 * Represents a terminal editor input for a tab.
 * Used for tabs displaying terminal sessions.
 */
class TerminalEditorTabInput() : TabInputBase(TabInputKind.TERMINAL_EDITOR_INPUT.value)

/**
 * Tab input, corresponding to VSCode's INotebookEditorTabInput
 * Represents a notebook editor input for a tab
 */
/**
 * Represents a notebook editor input for a tab.
 * Used for tabs displaying notebook files.
 */
class NotebookEditorTabInput(
    var uri: URI,
    val notebookType: String,
) : TabInputBase(TabInputKind.NOTEBOOK_INPUT.value)

/**
 * Tab input, corresponding to VSCode's INotebookDiffEditorTabInput
 * Represents a notebook diff editor input for comparing two notebooks
 */
data class NotebookDiffEditorTabInput(
    var original: URI,
    var modified: URI,
    var notebookType: String,
) : TabInputBase(TabInputKind.NOTEBOOK_DIFF_INPUT.value)

/**
 * Tab input, corresponding to VSCode's IInteractiveWindowInput
 * Represents an interactive window input for a tab
 */
data class InteractiveWindowInput(
    var uri: URI,
    var inputBoxUri: URI,
) : TabInputBase(TabInputKind.INTERACTIVE_EDITOR_INPUT.value)

/**
 * Tab input, corresponding to VSCode's IChatEditorTabInput
 * Represents a chat editor input for a tab
 */
/**
 * Represents a chat editor input for a tab.
 * Used for tabs displaying chat interfaces.
 */
class ChatEditorTabInput() : TabInputBase(TabInputKind.CHAT_EDITOR_INPUT.value)

/**
 * Tab input, corresponding to VSCode's ITextDiffTabInput
 * Represents a text diff editor input for comparing two text files
 */
data class TextDiffTabInput(
    var original: URI,
    var modified: URI,
) : TabInputBase(TabInputKind.TEXT_DIFF_INPUT.value) {
    companion object {
        fun create(original: URI, modified: URI): TextDiffTabInput {
            return TextDiffTabInput(original, modified)
        }
    }
}

/**
 * Tab input, corresponding to VSCode's ITextMergeTabInput
 * Represents a text merge editor input for merging multiple text files
 */
data class TextMergeTabInput(
    var base: URI,
    var input1: URI,
    var input2: URI,
    var result: URI,
) : TabInputBase(TabInputKind.TEXT_MERGE_INPUT.value)

/**
 * Tab input, corresponding to VSCode's multi-diff editor input
 * Represents a multi-diff editor input for comparing multiple text files
 */
data class TextMultiDiffTabInput(
    var resources: List<URI>,
) : TabInputBase(TabInputKind.MULTI_DIFF_EDITOR_INPUT.value)
