package ai.kilocode.client.session.ui.prompt

import ai.kilocode.client.session.ui.editor.SessionEditorTextField
import ai.kilocode.client.session.ui.selection.SessionSelection
import com.intellij.openapi.actionSystem.DataSink
import com.intellij.openapi.project.Project
import com.intellij.util.textCompletion.TextCompletionProvider

internal class PromptEditorTextField(
    project: Project,
    ctx: SendPromptContext,
    private val speech: SpeechInputContext,
    completion: TextCompletionProvider?,
    selection: SessionSelection? = null,
) : SessionEditorTextField(project, ctx, completion, selection) {
    override fun uiDataSnapshot(sink: DataSink) {
        super.uiDataSnapshot(sink)
        sink[PromptDataKeys.SPEECH] = speech
    }
}
