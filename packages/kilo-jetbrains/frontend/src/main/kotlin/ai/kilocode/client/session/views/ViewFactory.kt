package ai.kilocode.client.session.views

import ai.kilocode.client.session.SessionFileOpener
import ai.kilocode.client.session.views.base.GenericView
import ai.kilocode.client.session.views.base.PartView
import ai.kilocode.client.session.views.question.QuestionResultView
import ai.kilocode.client.session.views.tool.GlobToolView
import ai.kilocode.client.session.views.tool.ReadToolView
import ai.kilocode.client.session.views.tool.SearchToolView
import ai.kilocode.client.session.views.tool.ShellToolView
import ai.kilocode.client.session.views.tool.ToolView
import ai.kilocode.client.session.ui.selection.SessionSelection
import ai.kilocode.client.session.model.Compaction
import ai.kilocode.client.session.model.Content
import ai.kilocode.client.session.model.FileAttachment
import ai.kilocode.client.session.model.Generic
import ai.kilocode.client.session.model.Reasoning
import ai.kilocode.client.session.model.StepFinish
import ai.kilocode.client.session.model.Text
import ai.kilocode.client.session.model.Tool
import ai.kilocode.client.session.views.todo.TodoWriteView

/**
 * Creates the appropriate [PartView] for a given [Content] subtype.
 *
 * Adding a new content type means:
 * 1. Add a subclass of [Content] in the model.
 * 2. Add a [PartView] subclass in this package.
 * 3. Add a branch here — the exhaustive `when` will surface the gap as a compile error.
 */
object ViewFactory {
    fun create(
        content: Content,
        openFile: SessionFileOpener,
    ): PartView = create(content, openFile, openUrl = {}, selection = null, repo = null)

    fun create(
        content: Content,
        openFile: SessionFileOpener,
        openUrl: (String) -> Unit = {},
        selection: SessionSelection? = null,
        repo: String? = null,
        openAttachment: (FileAttachment) -> Unit = { AttachmentView.openDefault(it, openFile, openUrl) },
    ): PartView = when (content) {
        is Text -> TextView(content, openFile = openFile, openUrl = openUrl, selection = selection)
        is Reasoning -> ReasoningView(content, openFile = openFile, openUrl = openUrl, selection = selection)
        is FileAttachment -> AttachmentView(content, openAttachment)
        is Tool -> when {
            TodoWriteView.canRender(content) -> TodoWriteView(content)
            PlanExitView.canRender(content) -> PlanExitView(content, openFile, openUrl, selection)
            QuestionResultView.canRender(content) -> QuestionResultView(content, selection)
            ShellToolView.canRender(content) -> ShellToolView(content, selection = selection)
            GlobToolView.canRender(content) -> GlobToolView(content, selection = selection, repo = repo)
            SearchToolView.canRender(content) -> SearchToolView(content, selection = selection, repo = repo)
            ReadToolView.canRender(content) -> ReadToolView(content, openFile, selection = selection)
            else -> ToolView(content, selection = selection)
        }
        is Compaction -> CompactionView(content)
        is StepFinish -> error("step-finish is timeline-only")
        is Generic -> GenericView(content)
    }

    fun createUser(
        content: Content,
        openFile: SessionFileOpener,
    ): PartView = createUser(content, openFile, openUrl = {}, selection = null, repo = null)

    fun createUser(
        content: Content,
        openFile: SessionFileOpener,
        openUrl: (String) -> Unit = {},
        selection: SessionSelection? = null,
        repo: String? = null,
        mentions: List<PromptMention> = emptyList(),
        openAttachment: (FileAttachment) -> Unit = { AttachmentView.openDefault(it, openFile, openUrl) },
    ): PartView = when (content) {
        is Text -> PromptView(content, openFile = openFile, openAttachment = openAttachment, openUrl = openUrl, selection = selection, mentions = mentions)
        else -> create(content, openFile, openUrl, selection, repo, openAttachment)
    }

    /**
     * Returns true when [view] must be replaced by a new renderer for [content].
     * This happens when a running question tool (rendered as [ToolView]) completes
     * with structured data and should become a [QuestionResultView].
     */
    fun shouldReplace(view: PartView, content: Content): Boolean {
        if (content !is Tool) return false
        if (view is TodoWriteView) return !TodoWriteView.canRender(content)
        if (view !is TodoWriteView && TodoWriteView.canRender(content)) return true
        if (view is PlanExitView) return !PlanExitView.canRender(content)
        if (view !is PlanExitView && PlanExitView.canRender(content)) return true
        if (view is QuestionResultView) return !QuestionResultView.canRender(content)
        if (view is ShellToolView) return !ShellToolView.canRender(content) || QuestionResultView.canRender(content)
        if (view !is ShellToolView && ShellToolView.canRender(content)) return true
        if (view is GlobToolView) return !GlobToolView.canRender(content) || QuestionResultView.canRender(content)
        if (view !is GlobToolView && GlobToolView.canRender(content)) return true
        if (view is SearchToolView) return !SearchToolView.canRender(content) || QuestionResultView.canRender(content)
        if (view !is SearchToolView && SearchToolView.canRender(content)) return true
        if (view is ReadToolView) return !ReadToolView.canRender(content) || QuestionResultView.canRender(content)
        if (view is ToolView && ReadToolView.canRender(content)) return true
        if (view is ToolView) return QuestionResultView.canRender(content)
        return false
    }
}
