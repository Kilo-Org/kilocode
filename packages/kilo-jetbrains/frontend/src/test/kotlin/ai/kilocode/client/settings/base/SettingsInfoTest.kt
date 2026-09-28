package ai.kilocode.client.settings.base

import ai.kilocode.client.util.edtWait
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.ui.EditorNotificationPanel
import com.intellij.ui.InlineBanner
import com.intellij.ui.components.labels.LinkLabel
import com.intellij.util.ui.UIUtil
import javax.swing.JEditorPane

/**
 * Behavior contract for the expandable settings info banner used on every Agent Behavior
 * sub-page: collapsed by default, `Show more` reveals the long explanation and a `Learn more`
 * doc link, `Show less` hides both again. Mirrors the coverage pattern in
 * [ai.kilocode.client.session.board.SessionBoardDialogTest].
 */
class SettingsInfoTest : BasePlatformTestCase() {
    fun `test collapsed banner shows only the intro`() {
        val info = info()

        val text = bannerText(info)
        assertTrue("expected the intro sentence", text.contains("Intro sentence."))
        assertFalse("long explanation must stay hidden", text.contains("Longer explanation."))
        assertEquals("Show more", toggleLink(info).text)
    }

    fun `test collapsed banner has no visible learn more link`() {
        val info = info()

        assertNull("learn more must be hidden until expanded", learnMoreLinkOrNull(info))
    }

    fun `test expanding reveals the long explanation, flips the link, and shows learn more`() {
        val info = info()

        edt { toggleLink(info).doClick() }

        val text = bannerText(info)
        assertTrue("intro stays visible", text.contains("Intro sentence."))
        assertTrue("long explanation appears", text.contains("Longer explanation."))
        assertEquals("Show less", toggleLink(info).text)
        assertNotNull("learn more must appear once expanded", learnMoreLinkOrNull(info))
    }

    fun `test collapsing hides the long explanation and learn more again`() {
        val info = info()

        edt { toggleLink(info).doClick() }
        edt { toggleLink(info).doClick() }

        assertFalse("long explanation hidden again", bannerText(info).contains("Longer explanation."))
        assertEquals("Show more", toggleLink(info).text)
        assertNull("learn more hidden again", learnMoreLinkOrNull(info))
    }

    fun `test learn more opens the doc link`() {
        var opened: String? = null
        val info = SettingsInfo("Intro sentence.", "Longer explanation.", "https://kilo.ai/docs/example") { url -> opened = url }

        edt { toggleLink(info).doClick() }
        edt { learnMoreLinkOrNull(info)!!.doClick() }

        assertEquals("https://kilo.ai/docs/example", opened)
    }

    fun `test banner without a doc link exposes only the toggle action`() {
        val info = SettingsInfo("Intro sentence.", "Longer explanation.", doc = null)

        edt { toggleLink(info).doClick() }

        assertTrue("expanded body still shows", bannerText(info).contains("Longer explanation."))
        assertNull("no doc link without a URL", learnMoreLinkOrNull(info))
    }

    fun `test banner is an info status platform banner`() {
        val info = info()

        assertEquals(EditorNotificationPanel.Status.Info, info.status)
    }

    private fun info() = SettingsInfo("Intro sentence.", "Longer explanation.", "https://kilo.ai/docs/example")

    /**
     * The banner renders its message in an HTML [JEditorPane]; whitespace is normalized because
     * the pane re-serializes the document through `HTMLWriter`, which hard-wraps long lines.
     */
    private fun bannerText(info: SettingsInfo): String {
        val pane = UIUtil.findComponentOfType(info, JEditorPane::class.java) ?: error("no banner text")
        return pane.text.replace(Regex("\\s+"), " ")
    }

    private fun toggleLink(info: InlineBanner): LinkLabel<*> =
        UIUtil.findComponentsOfType(info, LinkLabel::class.java)
            .first { it.text == "Show more" || it.text == "Show less" }

    private fun learnMoreLinkOrNull(info: InlineBanner): LinkLabel<*>? =
        UIUtil.findComponentsOfType(info, LinkLabel::class.java)
            .filter { it.text == "Learn more" }
            .singleOrNull { it.isVisible }

    private fun <T> edt(block: () -> T): T = edtWait(block)
}
