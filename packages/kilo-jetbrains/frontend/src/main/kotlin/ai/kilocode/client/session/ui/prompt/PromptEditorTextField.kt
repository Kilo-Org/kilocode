package ai.kilocode.client.session.ui.prompt

import ai.kilocode.client.session.ui.editor.SessionEditorTextField
import com.intellij.openapi.project.Project

internal class PromptEditorTextField(
    project: Project,
    ctx: SendPromptContext,
) : SessionEditorTextField(project, ctx)
