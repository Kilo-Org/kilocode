package ai.kilocode.client.settings.base

import ai.kilocode.client.plugin.KiloBundle
import com.intellij.ide.BrowserUtil
import com.intellij.util.concurrency.annotations.RequiresEdt

/**
 * A short, always-visible sentence explaining what a settings page configures, with a `Show more`
 * link that reveals a longer explanation and — once expanded — a `Learn more` link to the doc site.
 *
 * Follows the same shape as [ai.kilocode.client.session.board.SessionBoardDialog]'s banner: the
 * toggle sits in the banner's action row rather than inline in the sentence, because the banner
 * installs its own [com.intellij.ui.BrowserHyperlinkListener] on a message pane this class cannot
 * reach, so an in-text `<a href>` would be treated as a URL.
 */
internal class SettingsInfo(
    private val intro: String,
    private val more: String,
    private val doc: String? = null,
    private val browse: (String) -> Unit = BrowserUtil::browse,
) : WrapBanner(intro, SEED_WIDTH) {
    private var expanded = false

    private val toggle = addAction(KiloBundle.message("settings.info.showMore"), null) { flip() }
    private val learnMore = doc?.let { url ->
        addAction(KiloBundle.message("settings.info.learnMore"), null) { browse(url) }.apply { isVisible = false }
    }

    @RequiresEdt
    private fun flip() {
        expanded = !expanded
        sync()
    }

    private fun sync() {
        if (expanded) setCopy(intro, more) else setCopy(intro)
        toggle.text = KiloBundle.message(if (expanded) "settings.info.showLess" else "settings.info.showMore")
        learnMore?.isVisible = expanded
        revalidate()
        repaint()
    }

    private companion object {
        /** Seed column for the first layout pass, before Swing assigns the settings page's real width. */
        const val SEED_WIDTH = 480
    }
}
