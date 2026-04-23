package ai.kilocode.client.session.views

import ai.kilocode.client.session.model.Content
import ai.kilocode.client.session.model.Text
import ai.kilocode.client.ui.md.MdView
import java.awt.BorderLayout

/**
 * Renders a [Text] part as markdown using [MdView].
 *
 * Supports both full-replacement ([update]) and streaming append ([appendDelta]).
 */
class TextView(text: Text) : PartView() {

    override val contentId: String = text.id

    val md: MdView = MdView.html()

    init {
        layout = BorderLayout()
        isOpaque = false
        add(md.component, BorderLayout.CENTER)
        if (text.content.isNotEmpty()) md.set(text.content.toString())
    }

    override fun update(content: Content) {
        if (content !is Text) return
        md.set(content.content.toString())
    }

    override fun appendDelta(delta: String) {
        md.append(delta)
    }

    /** Current markdown source — used by tests to assert rendered content. */
    fun markdown(): String = md.markdown()

    override fun dumpLabel() = "TextView#$contentId"
}
