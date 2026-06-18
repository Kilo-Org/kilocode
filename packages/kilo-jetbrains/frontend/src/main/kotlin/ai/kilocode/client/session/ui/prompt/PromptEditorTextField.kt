package ai.kilocode.client.session.ui.prompt

import ai.kilocode.client.session.ui.editor.SessionEditorTextField
import ai.kilocode.client.session.ui.selection.SessionSelection
import com.intellij.openapi.project.Project

internal class PromptEditorTextField(
    project: Project,
    ctx: SendPromptContext,
    selection: SessionSelection? = null,
) : SessionEditorTextField(project, ctx, selection)
