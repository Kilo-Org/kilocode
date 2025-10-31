// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

package ai.kilocode.jetbrains.editor

import ai.kilocode.jetbrains.util.URI
import com.google.gson.Gson
import com.google.gson.JsonParser

data class FileEdit(
    val oldResource: URI?,
    val newResource: URI?,
    val options: Options?,
    val metadata: Metadata?,
) {
    data class Options(
        val overwrite: Boolean?,
        val ignoreIfExists: Boolean?,
        val copy: Boolean?,
        val contents: String?,
    )
}

data class Metadata(
    val isRefactoring: Boolean?,
)

data class Content(
    val range: Range,
    val text: String,
)

data class TextEdit(
    val resource: URI,
    val textEdit: Content,
    val metadata: Metadata?,
)

class WorkspaceEdit {
    val files: MutableList<FileEdit> = mutableListOf()
    val texts: MutableList<TextEdit> = mutableListOf()
    companion object {
        fun from(dto: String): WorkspaceEdit {
            val rst = WorkspaceEdit()
            val json = JsonParser.parseString(dto)
            val edits = json.asJsonObject.get("edits")
            if (edits.isJsonArray) {
                val array = edits.asJsonArray
                for (element in array) {
                    val edit = element.asJsonObject
                    if (edit.has("textEdit")) {
                        rst.texts.add(Gson().fromJson(edit, TextEdit::class.java))
                    } else if (edit.has("fileEdit")) {
                        rst.files.add(Gson().fromJson(edit, FileEdit::class.java))
                    }
                }
                return rst
            } else {
                throw IllegalArgumentException("WorkspaceEdit must be an array")
            }
        }
    }
}
