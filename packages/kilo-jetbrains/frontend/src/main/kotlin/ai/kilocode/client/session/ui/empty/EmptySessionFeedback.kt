package ai.kilocode.client.session.ui.empty

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.layout.HAlign
import ai.kilocode.client.ui.layout.Stack
import ai.kilocode.client.ui.layout.VAlign
import ai.kilocode.client.ui.layout.align
import com.intellij.icons.AllIcons
import com.intellij.openapi.Disposable
import com.intellij.openapi.ui.popup.Balloon
import com.intellij.openapi.ui.popup.JBPopupFactory
import com.intellij.openapi.util.Disposer
import com.intellij.openapi.util.IconLoader
import com.intellij.ui.awt.RelativePoint
import com.intellij.ui.components.JBLabel
import com.intellij.util.concurrency.annotations.RequiresEdt
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.UIUtil
import com.intellij.xml.util.XmlStringUtil
import java.awt.Cursor
import java.awt.Point
import java.awt.event.MouseAdapter
import java.awt.event.MouseEvent
import javax.swing.JButton
import javax.swing.JComponent

internal class EmptySessionFeedback(
    private val browse: (String) -> Unit,
) : Disposable {
    private var balloon: Balloon? = null

    val button: JButton = FeedbackButton().apply {
        addActionListener { popup() }
    }

    @RequiresEdt
    private fun popup() {
        balloon?.let {
            it.hide()
            return
        }

        val content = content { url ->
            browse(url)
            balloon?.hide()
        }
        val point = RelativePoint(button, Point(button.width / 2, button.height + JBUI.scale(1)))
        val popup = JBPopupFactory.getInstance()
            .createBalloonBuilder(content)
            .setHideOnClickOutside(true)
            .setHideOnKeyOutside(true)
            .setHideOnAction(true)
            .setHideOnFrameResize(true)
            .setBorderColor(UiStyle.Balloon.border())
            .setFillColor(UiStyle.Balloon.bg())
            .setBorderInsets(UiStyle.Balloon.insets())
            .setPointerSize(UiStyle.Balloon.pointer())
            .setCornerRadius(UiStyle.Balloon.arc())
            .createBalloon()

        balloon = popup
        popup.setAnimationEnabled(false)
        Disposer.register(popup) { balloon = null }
        popup.show(point, Balloon.Position.below)
    }

    private class FeedbackButton : EmptySessionPanel.ShowHistoryButton(buttonHtml(), AllIcons.Ide.Feedback)

    override fun dispose() {
        balloon?.hide()
    }

    private class ActionButton(text: String, icon: javax.swing.Icon, action: () -> Unit) : JButton(text, icon) {
        init {
            cursor = Cursor.getPredefinedCursor(Cursor.HAND_CURSOR)
            addActionListener { action() }
        }
    }

    companion object {
        @RequiresEdt
        fun content(open: (String) -> Unit): JComponent {
            val logo = JBLabel(IconLoader.getIcon("/icons/kilo-content.svg", EmptySessionPanel::class.java)).apply {
                horizontalAlignment = JBLabel.CENTER
                cursor = Cursor.getPredefinedCursor(Cursor.HAND_CURSOR)
                addMouseListener(object : MouseAdapter() {
                    override fun mouseClicked(e: MouseEvent) {
                        open(KILO_URL)
                    }
                })
            }
            val msg = JBLabel(messageHtml()).apply {
                foreground = UIUtil.getLabelForeground()
                horizontalAlignment = JBLabel.CENTER
            }
            val actions = Stack.vertical(gap = UiStyle.Gap.sm())
                .next(ActionButton(KiloBundle.message("feedback.dialog.github"), AllIcons.Vcs.Vendors.Github) {
                    open(GITHUB_ISSUES_URL)
                }.align(HAlign.CENTER, VAlign.CENTER))
                .next(ActionButton(KiloBundle.message("feedback.dialog.discord"), DISCORD_ICON) {
                    open(DISCORD_URL)
                }.align(HAlign.CENTER, VAlign.CENTER))
                .next(ActionButton(KiloBundle.message("feedback.dialog.support"), AllIcons.Actions.Help) {
                    open(SUPPORT_URL)
                }.align(HAlign.CENTER, VAlign.CENTER))

            return Stack.vertical(gap = UiStyle.Gap.lg())
                .fill(UiStyle.Gap.sm())
                .next(logo.align(HAlign.CENTER, VAlign.CENTER))
                .next(msg.align(HAlign.CENTER, VAlign.CENTER))
                .fill(UiStyle.Gap.xs())
                .next(actions.align(HAlign.CENTER, VAlign.CENTER))
                .fill(UiStyle.Gap.xs())
        }

        fun urls() = listOf(GITHUB_ISSUES_URL, DISCORD_URL, SUPPORT_URL)

        private fun messageHtml() = XmlStringUtil.wrapInHtml(
            "<div style='text-align:center'>${XmlStringUtil.escapeString(KiloBundle.message("feedback.dialog.message"))}</div>"
        )

        private fun buttonHtml() = XmlStringUtil.wrapInHtml(
            XmlStringUtil.escapeString(KiloBundle.message("feedback.button"))
        )

        private const val KILO_URL = "https://kilocode.ai"
        private const val GITHUB_ISSUES_URL = "https://github.com/Kilo-Org/kilocode/issues/new/choose"
        private const val DISCORD_URL = "https://kilo.ai/discord"
        private const val SUPPORT_URL = "https://kilo.ai/support"
        private val DISCORD_ICON = IconLoader.getIcon("/icons/discord.svg", EmptySessionPanel::class.java)
    }
}
