package ai.kilocode.client.settings.autoapprove

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.settings.base.BaseContentPanel
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.layout.Stack
import ai.kilocode.rpc.dto.PermissionRuleDto
import com.intellij.ui.components.JBLabel
import com.intellij.util.concurrency.annotations.RequiresEdt
import javax.swing.ListSelectionModel

/** One granular permission tool (`external_directory`, `bash`, `read`, `edit`). */
internal class GranularToolSection(
    private val     tool: String,
    description: String,
    addLabel: String,
    placeholder: String,
    picker: LevelPicker,
    private val onWildcardChange: (String) -> Unit,
    private val onWildcardInherit: () -> Unit,
    private val onExceptionAdd: (String) -> Unit,
    private val onExceptionSetLevel: (String, String) -> Unit,
    private val onExceptionRemove: (List<String>) -> Unit,
) : BaseContentPanel() {
    private val wildcard = LevelSelect(onWildcardChange) { onWildcardInherit() }
    private val list = SettingsInlineList(
        empty = KiloBundle.message("settings.autoApprove.filters.empty"),
        search = KiloBundle.message("settings.autoApprove.filters.search"),
        addLabel = addLabel,
        placeholder = placeholder,
        right = toolbarRight(),
        onAdd = onExceptionAdd,
        onSetLevel = onExceptionSetLevel,
        onRemove = onExceptionRemove,
        picker = picker,
        selectionMode = ListSelectionModel.MULTIPLE_INTERVAL_SELECTION,
    )

    init {
        section(toolTitle(tool), description)
            .row(list)
    }

    @RequiresEdt
    fun sync(rule: PermissionRuleDto?, enabled: Boolean) {
        wildcard.sync(wildcardLevel(rule) ?: defaultLevel(tool), inheritedWildcard(rule), enabled)
        list.syncItems(exceptions(rule), enabled)
    }

    private fun toolbarRight() = Stack.horizontal(UiStyle.Gap.sm())
        .next(JBLabel(KiloBundle.message("settings.autoApprove.defaultSetting")))
        .next(wildcard)
}
