package ai.kilocode.client.settings.autoapprove

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.settings.base.SettingsInlineListPanel
import ai.kilocode.client.settings.base.SettingsListCell
import ai.kilocode.client.settings.base.SettingsListConfig
import ai.kilocode.client.settings.base.SettingsListItem
import ai.kilocode.client.settings.base.SettingsToolbarAction
import ai.kilocode.client.settings.base.settingsListCellBounds
import com.intellij.icons.AllIcons
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.ui.Messages
import com.intellij.openapi.ui.popup.JBPopupFactory
import com.intellij.ui.SimpleListCellRenderer
import com.intellij.ui.awt.RelativePoint
import java.awt.Point
import javax.swing.ListSelectionModel

/**
 * Embeddable exception list for granular auto-approve tools. Uses the standard inline settings
 * list layout: toolbar, filter field, then list. The list supports multi-selection so toolbar
 * delete can remove many exceptions at once.
 */
internal class SettingsInlineList(
    private val addLabel: String,
    private val placeholder: String,
    private val onAdd: (String) -> Unit,
    private val onSetLevel: (String, String) -> Unit,
    private val onRemove: (List<String>) -> Unit,
) : SettingsInlineListPanel(
    KiloBundle.message("settings.autoApprove.exceptions.empty"),
    SettingsListConfig.Equal,
    ListSelectionModel.MULTIPLE_INTERVAL_SELECTION,
) {

    /** Overridable in tests, mirrors `PatternList.input` in ContextSettingsUi.kt. */
    internal var input: () -> String? = {
        Messages.showInputDialog(this, placeholder, addLabel, null)
    }

    init {
        start()
    }

    fun syncItems(exceptions: List<Pair<String, String>>, enabled: Boolean) {
        setItems(exceptions.map { (pattern, level) -> ExceptionItem(pattern, level) }, enabled)
    }

    override fun onCell(key: String, cellId: String) {
        if (!isEnabled) return
        if (cellId == "level") showLevelPopup(key)
    }

    override fun toolbarActions(): List<AnAction> = listOf(
        SettingsToolbarAction(
            KiloBundle.message("settings.autoApprove.add"),
            addLabel,
            AllIcons.General.Add,
            { isEnabled },
        ) { promptAdd() },
        SettingsToolbarAction(
            KiloBundle.message("settings.autoApprove.delete"),
            KiloBundle.message("settings.autoApprove.delete.description"),
            AllIcons.General.Remove,
            { isEnabled && selectedKeys().isNotEmpty() },
        ) { removeSelected() },
    )

    private fun promptAdd() {
        if (!isEnabled) return
        val value = input()?.trim().orEmpty()
        if (value.isBlank()) return
        onAdd(value)
    }

    private fun removeSelected() {
        val keys = selectedKeys()
        if (keys.isEmpty()) return
        onRemove(keys)
    }

    private fun showLevelPopup(pattern: String) {
        val model = view.list.model
        val index = (0 until model.size).firstOrNull { (model.getElementAt(it) as? ExceptionItem)?.pattern == pattern }
            ?: return
        val bounds = settingsListCellBounds(view.list, index, index == view.list.selectedIndex)["level"] ?: return
        JBPopupFactory.getInstance()
            .createPopupChooserBuilder(LEVELS)
            .setRenderer(SimpleListCellRenderer.create("") { levelLabel(it) })
            .setItemChosenCallback { level -> onSetLevel(pattern, level) }
            .createPopup()
            .show(RelativePoint(view.list, Point(bounds.x, bounds.y + bounds.height)))
    }

    private data class ExceptionItem(val pattern: String, val level: String) : SettingsListItem {
        override val key: String get() = pattern
        override val title: String get() = pattern
        override val cells: List<SettingsListCell> = listOf(
            SettingsListCell(id = "level", label = levelLabel(level), alwaysVisible = true),
        )
    }
}
