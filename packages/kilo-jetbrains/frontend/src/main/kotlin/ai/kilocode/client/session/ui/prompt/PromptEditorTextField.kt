package ai.kilocode.client.session.ui.prompt

import com.intellij.openapi.actionSystem.DataSink
import com.intellij.openapi.fileTypes.PlainTextFileType
import com.intellij.openapi.project.Project
import com.intellij.ui.EditorTextField

internal class PromptEditorTextField(
    project: Project,
    private val ctx: SendPromptContext,
) : EditorTextField(project, PlainTextFileType.INSTANCE) {
    override fun uiDataSnapshot(sink: DataSink) {
        super.uiDataSnapshot(sink)
        sink.set(PromptDataKeys.SEND, ctx)
    }
}
