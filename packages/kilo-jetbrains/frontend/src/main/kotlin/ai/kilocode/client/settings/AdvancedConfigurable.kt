package ai.kilocode.client.settings

import ai.kilocode.client.app.KiloAppService
import ai.kilocode.client.plugin.KiloBundle
import com.intellij.openapi.application.EDT
import com.intellij.openapi.application.ModalityState
import com.intellij.openapi.application.asContextElement
import com.intellij.openapi.components.service
import com.intellij.openapi.options.Configurable
import com.intellij.openapi.options.ConfigurationException
import com.intellij.openapi.options.SearchableConfigurable
import javax.swing.JComponent
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class AdvancedConfigurable(
    private val settings: KiloLogSettingsService = KiloLogSettingsService.getInstance(),
    private val save: (KiloLogSettingsService) -> Unit = { it.apply() },
    private val app: KiloAppService = service(),
    private val newScope: () -> CoroutineScope = { CoroutineScope(SupervisorJob() + Dispatchers.Default) },
) : SearchableConfigurable, Configurable.NoScroll {
    private var ui: AdvancedSettingsUi? = null
    private var scope: CoroutineScope? = null

    override fun getId(): String = ID

    override fun getDisplayName(): String = KiloBundle.message("settings.advanced.displayName")

    override fun createComponent(): JComponent {
        settings.applyLocal()
        val panel = AdvancedSettingsUi()
        ui = panel
        val cs = newScope()
        scope = cs
        cs.launch {
            val value = app.indexWorktrees()
            withContext(edt) { panel.refreshIndexWorktrees(value) }
        }
        return panel
    }

    override fun isModified(): Boolean = ui?.modified() == true

    override fun apply() {
        val panel = ui ?: return
        val err = panel.error()
        if (err != null) throw ConfigurationException(err)
        val value = panel.value()
        settings.update(value.level, value.mode, value.preview)
        save(settings)
        val indexWorktreesChanged = value.indexWorktrees != panel.savedIndexWorktrees()
        panel.sync()
        // Runs on the app scope, not ours: OK calls apply() then disposeUIResources(), which cancels
        // this configurable's scope before a coroutine launched here could reach the RPC.
        if (indexWorktreesChanged) app.setIndexWorktreesAsync(value.indexWorktrees)
    }

    override fun reset() {
        ui?.resetForm()
    }

    override fun disposeUIResources() {
        scope?.cancel()
        scope = null
        ui = null
    }

    companion object {
        const val ID = "ai.kilocode.jetbrains.settings.advanced"
        private val edt = Dispatchers.EDT + ModalityState.any().asContextElement()
    }
}
