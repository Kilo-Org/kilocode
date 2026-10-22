package ai.kilocode.client.settings.base

import com.intellij.ui.components.OnOffButton

internal class SettingsToggle(
    selected: Boolean = false,
    private val onToggle: (Boolean) -> Unit,
) : OnOffButton() {
    init {
        isSelected = selected
        addActionListener { onToggle(isSelected) }
    }
}
