package ai.kilocode.client.settings.base

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.layout.Stack
import com.intellij.ide.BrowserUtil
import com.intellij.ui.components.labels.LinkLabel
import com.intellij.util.concurrency.annotations.RequiresEdt

/**
 * A short, always-visible sentence explaining what a settings page configures, with a `Show more`
 * link that reveals a longer explanation and a `Learn more` link to the doc site. Both links stay
 * right-aligned beside the intro so the collapsed banner remains a single row.
 */
internal class SettingsInfo(
    private val intro: String,
    private val more: String,
    private val doc: String? = null,
    private val browse: (String) -> Unit = BrowserUtil::browse,
) : WrapBanner(intro, SEED_WIDTH) {
    private var expanded = false

    private val toggle = link(KiloBundle.message("settings.info.showMore"), ::flip)
    private val learnMore = doc?.let { url ->
        link(KiloBundle.message("settings.info.learnMore")) { browse(url) }
    }

    init {
        val actions = Stack.horizontal(UiStyle.Gap.lg()).next(toggle)
        learnMore?.let(actions::next)
        setTrailing(actions)
    }

    @RequiresEdt
    private fun flip() {
        expanded = !expanded
        sync()
    }

    private fun sync() {
        if (expanded) setCopy(intro, more) else setCopy(intro)
        toggle.text = KiloBundle.message(if (expanded) "settings.info.showLess" else "settings.info.showMore")
        revalidate()
        repaint()
    }

    private fun link(text: String, action: () -> Unit) = LinkLabel<Runnable>(
        text,
        null,
        { _, runnable -> runnable.run() },
        Runnable(action),
    )

    private companion object {
        /** Seed column for the first layout pass, before Swing assigns the settings page's real width. */
        const val SEED_WIDTH = 480
    }
}
