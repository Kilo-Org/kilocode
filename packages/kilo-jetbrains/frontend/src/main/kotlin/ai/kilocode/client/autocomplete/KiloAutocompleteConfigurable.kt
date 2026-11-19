package ai.kilocode.client.autocomplete

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.settings.base.BaseContentPanel
import ai.kilocode.client.settings.base.SettingsRow
import ai.kilocode.client.settings.base.SettingsToggle
import com.intellij.openapi.options.SearchableConfigurable
import com.intellij.openapi.ui.ComboBox
import javax.swing.JComponent

class KiloAutocompleteConfigurable : SearchableConfigurable {
    private var auto: SettingsToggle? = null
    private var model: ComboBox<String>? = null
    override fun getId() = "ai.kilocode.jetbrains.settings.autocomplete"
    override fun getDisplayName() = KiloBundle.message("settings.autocomplete.title")

    override fun createComponent(): JComponent {
        val trigger = SettingsToggle {}.also { auto = it }
        val picker = ComboBox(arrayOf("Kilo Gateway / Codestral", "Mistral / Codestral")).also { model = it }
        reset()
        return BaseContentPanel().apply {
            section(displayName).apply {
                row(SettingsRow(KiloBundle.message("settings.autocomplete.autoTrigger.title"), value = trigger))
                row(SettingsRow(KiloBundle.message("settings.autocomplete.model.title"), value = picker))
            }
        }
    }

    override fun reset() {
        val state = KiloAutocompleteSettingsService.getInstance().getState()
        auto?.isSelected = state.enableAutoTrigger != false
        model?.selectedIndex = if (state.directMistral) 1 else 0
    }

    override fun apply() {
        val state = KiloAutocompleteSettingsService.getInstance().getState()
        state.enableAutoTrigger = auto?.isSelected ?: return
        state.directMistral = model?.selectedIndex == 1
    }

    override fun isModified(): Boolean {
        val state = KiloAutocompleteSettingsService.getInstance().getState()
        return auto?.let { it.isSelected != (state.enableAutoTrigger != false) || (model?.selectedIndex == 1) != state.directMistral } ?: false
    }

    override fun disposeUIResources() { auto = null; model = null }
}
