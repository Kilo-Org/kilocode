package ai.kilocode.client.settings.autoapprove

import ai.kilocode.client.plugin.KiloBundle
import com.intellij.openapi.ui.ComboBox
import com.intellij.ui.SimpleListCellRenderer
import com.intellij.util.concurrency.annotations.RequiresEdt
import java.awt.event.ItemEvent
import javax.swing.DefaultComboBoxModel

internal fun levelLabel(level: String): String = when (level) {
    "allow" -> KiloBundle.message("settings.autoApprove.level.allow")
    "ask" -> KiloBundle.message("settings.autoApprove.level.ask")
    "deny" -> KiloBundle.message("settings.autoApprove.level.deny")
    else -> level
}

/**
 * Reusable Allow/Ask/Deny combo, optionally prefixed with a "Default (X)" inherit option.
 * Used by every non-list permission row and every granular wildcard row.
 */
internal class LevelSelect(
    private val onChange: (String) -> Unit,
    private val onInherit: (() -> Unit)? = null,
) : ComboBox<LevelSelect.Item>(DefaultComboBoxModel()) {

    internal sealed class Item {
        data class Default(val resolved: String) : Item()
        data class Level(val value: String) : Item()
    }

    private var syncing = false

    init {
        renderer = SimpleListCellRenderer.create("") { item ->
            when (item) {
                is Item.Default -> KiloBundle.message("settings.autoApprove.default", levelLabel(item.resolved))
                is Item.Level -> levelLabel(item.value)
            }
        }
        addItemListener { e ->
            if (syncing || e.stateChange != ItemEvent.SELECTED) return@addItemListener
            when (val item = e.item as? Item) {
                is Item.Default -> onInherit?.invoke()
                is Item.Level -> onChange(item.value)
                null -> Unit
            }
        }
    }

    @RequiresEdt
    fun sync(currentLevel: String, inherited: Boolean, enabled: Boolean) {
        syncing = true
        val next = DefaultComboBoxModel<Item>()
        if (onInherit != null) next.addElement(Item.Default(currentLevel))
        for (level in LEVELS) next.addElement(Item.Level(level))
        model = next
        selectedItem = if (inherited && onInherit != null) Item.Default(currentLevel) else Item.Level(currentLevel)
        isEnabled = enabled
        syncing = false
    }
}
