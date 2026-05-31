package ai.kilocode.client.session.ui.editor

import ai.kilocode.client.session.ui.prompt.PromptDataKeys
import ai.kilocode.client.session.ui.prompt.SendPromptContext
import com.intellij.openapi.actionSystem.DataSink
import com.intellij.openapi.fileTypes.PlainTextFileType
import com.intellij.openapi.project.Project
import com.intellij.ui.EditorTextField

/**
 * A session-scoped [EditorTextField] for plain-text input.
 *
 * When [ctx] is non-null the component injects it into the data context so
 * shortcut-based send/stop actions work (prompt use-case). When [ctx] is null
 * the component does not expose [PromptDataKeys.SEND], preventing accidental
 * `SendPromptAction` dispatch from question custom-answer editors.
 *
 * Both instances are created on the EDT. The underlying [EditorTextField]
 * lazily initializes its IntelliJ editor the first time the component becomes
 * visible; that initialization calls `EditorThreading.compute` internally,
 * satisfying the platform's read-context requirement without additional
 * wrapping here.
 */
internal open class SessionEditorTextField(
    project: Project,
    private val ctx: SendPromptContext? = null,
) : EditorTextField(project, PlainTextFileType.INSTANCE) {
    override fun uiDataSnapshot(sink: DataSink) {
        super.uiDataSnapshot(sink)
        ctx?.let { sink.set(PromptDataKeys.SEND, it) }
    }
}
