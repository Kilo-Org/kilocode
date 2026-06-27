package ai.kilocode.client.settings.base

import com.intellij.openapi.Disposable
import kotlinx.coroutines.CoroutineScope
import javax.swing.JComponent

abstract class DraftReadyConfigurable<T : JComponent> : KiloReadyConfigurable() {
    private var panel: T? = null

    final override fun createReadyComponent(cs: CoroutineScope): JComponent {
        val ui = create(cs)
        panel = ui
        return ui
    }

    override fun isModifiedReady(): Boolean = (panel as? SettingsDraftPage)?.modified() == true

    override fun applyReady() {
        (panel as? SettingsDraftPage)?.applyDraft()
    }

    override fun resetReady() {
        (panel as? SettingsDraftPage)?.resetDraft()
    }

    override fun disposeReadyComponent(component: JComponent) {
        val ui = panel
        panel = null
        (ui as? Disposable)?.dispose()
    }

    protected abstract fun create(cs: CoroutineScope): T
}
