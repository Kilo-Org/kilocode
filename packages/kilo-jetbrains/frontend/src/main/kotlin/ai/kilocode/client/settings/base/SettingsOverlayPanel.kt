package ai.kilocode.client.settings.base

import ai.kilocode.client.ui.LayeredOverlayPanel
import ai.kilocode.client.ui.UiStyle
import com.intellij.util.concurrency.annotations.RequiresEdt
import java.awt.Rectangle

internal open class SettingsOverlayPanel : LayeredOverlayPanel() {
    val progress = SettingsProgressOverlay()
    private var host: SettingsOverlayPanel? = null

    init {
        addOverlay(progress) { pane, child ->
            val size = child.preferredSize
            Rectangle(
                ((pane.width - size.width) / 2).coerceAtLeast(0),
                UiStyle.Gap.pad(),
                size.width,
                size.height,
            )
        }
    }

    @RequiresEdt
    fun setOverlayHost(host: SettingsOverlayPanel?) {
        if (host === this) {
            this.host = null
            return
        }
        this.host?.clearProgress()
        this.host = host
        progress.clearProgress()
        syncOverlay()
    }

    @RequiresEdt
    fun showProgress(text: String) {
        val panel = target()
        panel.progress.showProgress(text)
        panel.syncOverlay()
    }

    @RequiresEdt
    fun showProgress(text: String, cancelText: String, cancel: () -> Unit) {
        val panel = target()
        panel.progress.showProgress(text, cancelText, cancel)
        panel.syncOverlay()
    }

    @RequiresEdt
    fun updateProgress(text: String) {
        val panel = target()
        panel.progress.updateProgress(text)
        panel.syncOverlay()
    }

    @RequiresEdt
    fun showError(text: String) {
        val panel = target()
        panel.progress.showError(text)
        panel.syncOverlay()
    }

    @RequiresEdt
    fun clearProgress() {
        val panel = target()
        panel.progress.clearProgress()
        panel.syncOverlay()
    }

    private fun target(): SettingsOverlayPanel = host ?: this

    private fun syncOverlay() {
        overlay.revalidate()
        overlay.repaint()
        content.repaint()
        revalidate()
        repaint()
    }
}
