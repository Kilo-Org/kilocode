package ai.kilocode.client.settings.base

import com.intellij.openapi.util.text.HtmlChunk
import com.intellij.ui.EditorNotificationPanel.Status
import com.intellij.ui.InlineBanner
import java.awt.event.ComponentAdapter
import java.awt.event.ComponentEvent

/**
 * The platform's information banner, carrying copy that re-wraps to the width it is actually given.
 *
 * Swing cannot ask an HTML view "how tall are you at some width you do not have yet", so [seed] is the
 * column the first layout wraps at — that is what the dialog packs around. Once Swing has assigned a
 * real width, the text re-wraps to it, which keeps a resized banner from leaving a ragged right edge.
 * Re-wrapping is skipped unless the width actually changed, so the resize does not loop.
 *
 * [copy] is one or more paragraphs of plain text; each is escaped and paragraphs are joined with a
 * blank line, so callers never build raw HTML by hand.
 */
internal open class WrapBanner(copy: String, private val seed: Int) : InlineBanner("", Status.Info) {
    private var paragraphs = listOf(copy)
    private var applied = 0

    /** Measured once per banner: chrome cannot change mid-resize, and [chrome] builds a component. */
    private val chrome = chrome()

    init {
        showCloseButton(false)
        wrap(seed)
        addComponentListener(object : ComponentAdapter() {
            override fun componentResized(e: ComponentEvent) = wrap(width - chrome)
        })
    }

    /** Replaces the wrapped copy and re-wraps immediately at the last applied width, or [seed]. */
    protected fun setCopy(vararg copy: String) {
        paragraphs = copy.toList()
        applied = 0
        wrap(if (width > 0) width - chrome else seed)
    }

    private fun wrap(to: Int) {
        if (to <= 0 || to == applied) return
        applied = to
        setMessage(
            HtmlChunk.div()
                .attr("width", to)
                .children(
                    paragraphs.flatMapIndexed { i, paragraph ->
                        if (i == paragraphs.lastIndex) listOf(HtmlChunk.text(paragraph))
                        else listOf(HtmlChunk.text(paragraph), HtmlChunk.br(), HtmlChunk.br())
                    },
                )
                .wrapWith(HtmlChunk.body())
                .wrapWith("html")
                .toString(),
        )
    }

    companion object {
        /**
         * Horizontal space a banner spends on itself — insets, icon, the gap after it, and the slot it
         * reserves for its buttons. Measured from an empty banner rather than rebuilt from the platform's
         * constants, so it stays right if any of them change. Callers should hold the result rather than
         * call this per layout pass; it constructs a banner to measure.
         */
        fun chrome(): Int = InlineBanner("", Status.Info).showCloseButton(false).preferredSize.width
    }
}
