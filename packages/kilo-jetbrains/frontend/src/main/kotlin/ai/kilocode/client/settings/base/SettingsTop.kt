package ai.kilocode.client.settings.base

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.layout.Stack
import ai.kilocode.client.ui.layout.StackAxis
import com.intellij.ui.EditorNotificationPanel
import com.intellij.ui.InlineBanner
import java.awt.BorderLayout
import javax.swing.JComponent
import javax.swing.JPanel

internal data class SettingsAction(
    val text: String,
    val run: (JComponent) -> Unit,
)

internal enum class SettingsBannerKind { WARNING, ERROR }

internal class SettingsTop : Stack(StackAxis.VERTICAL, UiStyle.Gap.md()) {
    private val slot = JPanel(BorderLayout())
    private var spec: BannerSpec? = null

    init {
        slot.isOpaque = false
        slot.isVisible = false
        next(slot)
        isVisible = false
    }

    fun showBanner(
        text: String,
        actions: List<SettingsAction>,
        kind: SettingsBannerKind = SettingsBannerKind.WARNING,
    ) {
        val next = BannerSpec(text, actions.map { it.text }, kind)
        if (spec != next) {
            val banner = InlineBanner(text, status(kind)).showCloseButton(false)
            actions.forEach { action ->
                banner.addAction(action.text, Runnable { action.run(banner) })
            }
            slot.removeAll()
            slot.add(banner, BorderLayout.CENTER)
            spec = next
        }
        show(slot)
    }

    fun showNotLoggedIn(run: (JComponent) -> Unit) {
        showBanner(
            KiloBundle.message("settings.login.message"),
            listOf(SettingsAction(KiloBundle.message("settings.login.action"), run)),
        )
    }

    fun hideBanner() {
        if (!slot.isVisible) return
        slot.isVisible = false
        sync(layout = true)
    }

    private fun show(component: JComponent) {
        if (component.isVisible) {
            sync(layout = false)
            return
        }
        component.isVisible = true
        sync(layout = true)
    }

    private fun sync(layout: Boolean) {
        val visible = slot.isVisible
        val changed = isVisible != visible
        isVisible = visible
        if (changed || layout) parent?.revalidate()
        parent?.repaint()
    }

    private fun status(kind: SettingsBannerKind) = when (kind) {
        SettingsBannerKind.WARNING -> EditorNotificationPanel.Status.Warning
        SettingsBannerKind.ERROR -> EditorNotificationPanel.Status.Error
    }

    private data class BannerSpec(
        val text: String,
        val actions: List<String>,
        val kind: SettingsBannerKind,
    )
}
