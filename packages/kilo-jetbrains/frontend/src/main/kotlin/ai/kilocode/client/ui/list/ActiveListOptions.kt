package ai.kilocode.client.ui.list

import ai.kilocode.client.ui.active.ActiveWeight
import javax.swing.ListSelectionModel

internal data class ActiveListOptions(
    val selection: Int = ListSelectionModel.SINGLE_SELECTION,
    val header: ActiveWeight = ActiveWeight.BOLD,
    val divider: Boolean = true,
)
