// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

package com.sina.weibo.agent.editor

import com.intellij.openapi.diff.impl.DiffUtil
import com.intellij.openapi.editor.event.EditorFactoryEvent
import com.intellij.openapi.editor.event.EditorFactoryListener
import com.intellij.openapi.fileEditor.FileDocumentManager
import com.sina.weibo.agent.util.URI
import java.lang.ref.WeakReference


class EditorListener : EditorFactoryListener {
    override fun editorCreated(event: EditorFactoryEvent) {
        val editor = event.editor
        if(DiffUtil.isDiffEditor(editor)){
            FileDocumentManager.getInstance().getFile(editor.document)?.let { file->
                val manager = editor.project?.getService(EditorAndDocManager::class.java)
                val url = URI.file(file.path)
                manager?.onIdeaDiffEditorCreated(url,editor)
            }
        }
        super.editorCreated(event)
    }

    override fun editorReleased(event: EditorFactoryEvent) {
        val editor = event.editor
        if(DiffUtil.isDiffEditor(editor)){
            FileDocumentManager.getInstance().getFile(editor.document)?.let { file->
                val manager = editor.project?.getService(EditorAndDocManager::class.java)
                val url = URI.file(file.path)
                manager?.onIdeaDiffEditorReleased(url,editor)
            }
        }
        super.editorReleased(event)
    }
}