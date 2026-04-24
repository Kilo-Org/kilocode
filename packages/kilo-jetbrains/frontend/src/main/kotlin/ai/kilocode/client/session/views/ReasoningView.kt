package ai.kilocode.client.session.views

import ai.kilocode.client.session.model.Content
import ai.kilocode.client.session.model.Reasoning
import ai.kilocode.client.ui.md.MdView
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.UIUtil
import java.awt.BorderLayout

/**
 * Renders a [Reasoning] part as markdown using [MdView].
 *
 * Styled more subtly than [TextView] — uses the context-help foreground
 * colour to indicate that this is internal model reasoning rather than
 * the final assistant answer.
 *
 * Supports streaming appends like [TextView].
 */
class ReasoningView(reasoning: Reasoning) : PartView() {

    override val contentId: String = reasoning.id

    val md: MdView = MdView.html()

    init {
        layout = BorderLayout()
        isOpaque = false
        border = JBUI.Borders.empty(0, JBUI.scale(8), 0, 0)

        // Dim the text so it reads as subordinate context, not the main reply
        md.foreground = UIUtil.getContextHelpForeground()
        md.opaque = false

        add(md.component, BorderLayout.CENTER)
        if (reasoning.content.isNotEmpty()) md.set(reasoning.content.toString())
    }

    override fun update(content: Content) {
        if (content !is Reasoning) return
        md.set(content.content.toString())
    }

    override fun appendDelta(delta: String) {
        md.append(delta)
    }

    /** Current markdown source — used by tests. */
    fun markdown(): String = md.markdown()

    override fun dumpLabel() = "ReasoningView#$contentId"
}
