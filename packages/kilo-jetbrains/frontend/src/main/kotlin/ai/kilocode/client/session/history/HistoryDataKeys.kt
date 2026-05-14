package ai.kilocode.client.session.history

import com.intellij.openapi.actionSystem.DataKey

data class HistorySelection(
    val source: HistorySource,
    val localItems: List<LocalHistoryItem>,
    val cloudItems: List<CloudHistoryItem>,
) {
    val selectedLocal: List<LocalHistoryItem> get() = if (source == HistorySource.LOCAL) localItems else emptyList()
}

object HistoryDataKeys {
    val SELECTION: DataKey<HistorySelection> = DataKey.create("ai.kilocode.client.session.history.HistorySelection")
    val CONTROLLER: DataKey<HistoryController> = DataKey.create("ai.kilocode.client.session.history.HistoryController")
}
