@file:Suppress("UnstableApiUsage")

package ai.kilocode.client.autocomplete

import com.intellij.codeInsight.inline.completion.InlineCompletion
import com.intellij.codeInsight.inline.completion.InlineCompletionEvent
import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.CommonDataKeys
import com.intellij.openapi.editor.EditorKind
import com.intellij.openapi.project.DumbAwareAction
import com.intellij.openapi.util.UserDataHolderBase

class GenerateInlineCompletionAction : DumbAwareAction() {
    override fun getActionUpdateThread() = ActionUpdateThread.EDT

    override fun update(e: AnActionEvent) {
        val editor = e.getData(CommonDataKeys.EDITOR)
        e.presentation.isEnabledAndVisible = e.project != null && editor != null && !editor.isViewer && editor.editorKind == EditorKind.MAIN_EDITOR
    }

    override fun actionPerformed(e: AnActionEvent) {
        val editor = e.getData(CommonDataKeys.EDITOR) ?: return
        InlineCompletion.getHandlerOrNull(editor)?.invokeEvent(InlineCompletionEvent.ManualCall(editor, KILO_INLINE_ID, UserDataHolderBase()))
    }
}
