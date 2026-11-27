package ai.kilocode.client.settings.models

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.ui.model.ModelPicker
import ai.kilocode.client.ui.layout.Stack
import ai.kilocode.client.ui.layout.StackAxis

internal class ModelSettingPicker : Stack(StackAxis.HORIZONTAL) {
    val picker = ModelPicker()
    private var active = true
    private var available = false

    init {
        picker.allowEmpty = true
        picker.emptyText = KiloBundle.message("settings.models.notSet")
        next(picker)
    }

    fun setItems(items: List<ModelPicker.Item>, selected: String?) {
        available = items.isNotEmpty() || picker.allowEmpty
        picker.setItems(items, selected)
        picker.isEnabled = active && available
    }

    override fun setEnabled(value: Boolean) {
        active = value
        super.setEnabled(value)
        picker.isEnabled = active && available
    }
}
