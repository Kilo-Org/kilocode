package ai.kilocode.client.agentManager

import ai.kilocode.client.plugin.KiloBundle
import com.intellij.openapi.ui.ComboBox
import com.intellij.ui.SimpleListCellRenderer
import com.intellij.util.concurrency.annotations.RequiresEdt

/** A section a new Agent Manager workspace can be filed under. */
sealed interface SectionChoice {
    object None : SectionChoice

    data class Group(val key: String, val title: String) : SectionChoice
}

/** Picks one Agent Manager section, with a leading "No section" entry for the tree root. */
internal class SectionPicker @RequiresEdt constructor(
    groups: List<SectionChoice.Group>,
    selected: String? = null,
) : ComboBox<SectionChoice>((listOf(SectionChoice.None) + groups).toTypedArray()) {
    init {
        renderer = SimpleListCellRenderer.create("") { choice ->
            when (choice) {
                SectionChoice.None -> KiloBundle.message("agentManager.section.none")
                is SectionChoice.Group -> choice.title
            }
        }
        selectedItem = groups.firstOrNull { it.key == selected } ?: SectionChoice.None
    }

    @RequiresEdt
    fun selected(): String? = (selectedItem as? SectionChoice.Group)?.key
}
