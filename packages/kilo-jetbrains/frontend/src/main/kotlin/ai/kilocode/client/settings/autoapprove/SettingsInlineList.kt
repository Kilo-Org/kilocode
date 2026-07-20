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
import com.intellij.openapi.ui.popup.JBPopup
import com.intellij.openapi.ui.popup.JBPopupFactory
import com.intellij.ui.SimpleListCellRenderer
import com.intellij.ui.awt.RelativePoint
import java.awt.Point
import javax.swing.JComponent
import javax.swing.ListSelectionModel

internal data class PermissionListRow(
    val key: String,
    val title: String,
    val description: String? = null,
    val level: String,
    val inherited: Boolean = false,
    val defaultLevel: String = level,
    val canInherit: Boolean = false,
    val editable: Boolean = false,
)

/** A level choice offered by the row popup: either revert to the CLI default or a concrete level. */
internal sealed interface LevelChoice {
    data class Default(val level: String) : LevelChoice
    data class Level(val level: String) : LevelChoice
}

/**
 * Renders the per-row level chooser. The production picker is a JBPopup anchored under the level
 * cell; tests substitute a picker that resolves a choice directly.
 */
internal fun interface LevelPicker {
    fun popup(choices: List<LevelChoice>, choose: (LevelChoice) -> Unit): JBPopup?
}

internal object PopupLevelPicker : LevelPicker {
    override fun popup(choices: List<LevelChoice>, choose: (LevelChoice) -> Unit): JBPopup =
        JBPopupFactory.getInstance()
            .createPopupChooserBuilder(choices)
            .setRenderer(SimpleListCellRenderer.create("") { levelChoiceLabel(it) })
            .setItemChosenCallback(choose)
            .createPopup()
}

internal fun levelChoiceLabel(choice: LevelChoice): String = when (choice) {
    is LevelChoice.Default -> KiloBundle.message("settings.autoApprove.default", levelLabel(choice.level))
    is LevelChoice.Level -> levelLabel(choice.level)
}

/**
 * Embeddable auto-approve permission list. Uses the standard inline settings list layout:
 * toolbar, filter field, then list with title/description rows and a right-side level action cell.
 */
internal class SettingsInlineList(
    private val empty: String,
    private val addLabel: String? = null,
    private val placeholder: String = "",
    private val right: JComponent? = null,
    private val onAdd: ((String) -> Unit)? = null,
    private val onSetLevel: (String, String) -> Unit,
    private val onInherit: ((String) -> Unit)? = null,
    private val onEdit: ((String, String) -> Unit)? = null,
    private val onRemove: ((List<String>) -> Unit)? = null,
    private val onSelect: (String?) -> Unit = {},
    private val picker: LevelPicker = PopupLevelPicker,
    selectionMode: Int = ListSelectionModel.SINGLE_SELECTION,
) : SettingsInlineListPanel(
    empty,
    SettingsListConfig.Equal,
    selectionMode,
    showSearch = false,
) {

    /** Overridable in tests, mirrors `PatternList.input` in ContextSettingsUi.kt. */
    internal var input: () -> String? = {
        Messages.showInputDialog(this, placeholder, addLabel.orEmpty(), null)
    }

    internal var editInput: (String) -> String? = { key ->
        Messages.showInputDialog(
            this,
            placeholder,
            KiloBundle.message("settings.autoApprove.edit"),
            null,
            key,
            null,
        )
    }

    init {
        start()
    }

    fun syncRows(rows: List<PermissionListRow>, enabled: Boolean) {
        setItems(rows.map(::PermissionItem), enabled)
    }

    fun syncItems(exceptions: List<Pair<String, String>>, enabled: Boolean) {
        syncRows(exceptions.map { (pattern, level) -> PermissionListRow(pattern, pattern, level = level, editable = true) }, enabled)
    }

    override fun onCell(key: String, cellId: String) {
        if (!isEnabled) return
        onSelect(key)
        if (cellId == LEVEL_CELL) showLevelPopup(key)
        if (cellId == EDIT_CELL) promptEdit(key)
    }

    override fun toolbarActions(): List<AnAction> = buildList {
        val add = addLabel
        if (add != null && onAdd != null) {
            add(SettingsToolbarAction(
                KiloBundle.message("settings.autoApprove.add"),
                add,
                AllIcons.General.Add,
                { isEnabled },
            ) { promptAdd() })
        }
        if (onRemove != null) {
            add(SettingsToolbarAction(
                KiloBundle.message("settings.autoApprove.delete"),
                KiloBundle.message("settings.autoApprove.delete.description"),
                AllIcons.General.Remove,
                { isEnabled && selectedKeys().isNotEmpty() },
            ) { removeSelected() })
        }
    }

    override fun toolbarRight(): JComponent? = right

    override fun onSelectionChanged(keys: List<String>) {
        onSelect(keys.firstOrNull())
    }

    private fun promptAdd() {
        if (!isEnabled) return
        val add = onAdd ?: return
        val value = input()?.trim().orEmpty()
        if (value.isBlank()) return
        add(value)
    }

    private fun promptEdit(key: String) {
        val edit = onEdit ?: return
        val value = editInput(key)?.trim().orEmpty()
        if (value.isBlank() || value == key) return
        edit(key, value)
    }

    private fun removeSelected() {
        val remove = onRemove ?: return
        val keys = selectedKeys()
        if (keys.isEmpty()) return
        remove(keys)
    }

    private fun showLevelPopup(key: String) {
        val item = item(key) ?: return
        val idx = index(key) ?: return
        val bounds = settingsListCellBounds(view.list, idx, idx == view.list.selectedIndex)[LEVEL_CELL] ?: return
        val popup = picker.popup(choices(item.row)) { choice -> choose(key, choice) } ?: return
        trackPopup(popup)
        popup.show(RelativePoint(view.list, Point(bounds.x, bounds.y + bounds.height)))
    }

    private fun item(key: String): PermissionItem? {
        val model = view.list.model
        return (0 until model.size)
            .mapNotNull { model.getElementAt(it) as? PermissionItem }
            .firstOrNull { it.key == key }
    }

    private fun index(key: String): Int? {
        val model = view.list.model
        return (0 until model.size).firstOrNull { (model.getElementAt(it) as? PermissionItem)?.key == key }
    }

    private fun choices(row: PermissionListRow): List<LevelChoice> = buildList {
        if (row.canInherit && onInherit != null) add(LevelChoice.Default(row.defaultLevel))
        LEVELS.forEach { add(LevelChoice.Level(it)) }
    }

    private fun choose(key: String, choice: LevelChoice) {
        onSelect(key)
        when (choice) {
            is LevelChoice.Default -> onInherit?.invoke(key)
            is LevelChoice.Level -> onSetLevel(key, choice.level)
        }
    }

    private data class PermissionItem(val row: PermissionListRow) : SettingsListItem {
        override val key: String get() = row.key
        override val title: String get() = row.title
        override val description: String? get() = row.description
        override val doubleClick: String? get() = EDIT_CELL.takeIf { row.editable }
        override val cells: List<SettingsListCell> = buildList {
            if (row.editable) add(SettingsListCell(
                id = EDIT_CELL,
                label = KiloBundle.message("settings.autoApprove.edit"),
            ))
            add(SettingsListCell(
                id = LEVEL_CELL,
                label = if (row.inherited) KiloBundle.message(
                    "settings.autoApprove.default",
                    levelLabel(row.defaultLevel),
                ) else levelLabel(row.level),
                alwaysVisible = true,
            ))
        }
    }

    private companion object {
        const val EDIT_CELL = "edit"
        const val LEVEL_CELL = "level"
    }
}
