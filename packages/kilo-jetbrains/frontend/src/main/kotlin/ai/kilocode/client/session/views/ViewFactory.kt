package ai.kilocode.client.session.views

import ai.kilocode.client.session.views.question.QuestionResultView
import ai.kilocode.client.session.model.Compaction
import ai.kilocode.client.session.model.Content
import ai.kilocode.client.session.model.Generic
import ai.kilocode.client.session.model.Reasoning
import ai.kilocode.client.session.model.StepFinish
import ai.kilocode.client.session.model.Text
import ai.kilocode.client.session.model.Tool

/**
 * Creates the appropriate [PartView] for a given [Content] subtype.
 *
 * Adding a new content type means:
 * 1. Add a subclass of [Content] in the model.
 * 2. Add a [PartView] subclass in this package.
 * 3. Add a branch here — the exhaustive `when` will surface the gap as a compile error.
 */
object ViewFactory {
    fun create(content: Content): PartView = when (content) {
        is Text -> TextView(content)
        is Reasoning -> ReasoningView(content)
        is Tool -> if (QuestionResultView.canRender(content)) QuestionResultView(content) else ToolView(content)
        is Compaction -> CompactionView(content)
        is StepFinish -> error("step-finish is timeline-only")
        is Generic -> GenericView(content)
    }

    /**
     * Returns true when [view] must be replaced by a new renderer for [content].
     * This happens when a running question tool (rendered as [ToolView]) completes
     * with structured data and should become a [QuestionResultView].
     */
    fun shouldReplace(view: PartView, content: Content): Boolean {
        if (content !is Tool) return false
        if (view is QuestionResultView) return !QuestionResultView.canRender(content)
        if (view is ToolView) return QuestionResultView.canRender(content)
        return false
    }
}
