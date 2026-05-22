package ai.kilocode.client.session.ui.model

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.rpc.dto.ModelSelectionDto

internal fun modelPickerRows(
    items: List<ModelPicker.Item>,
    favorites: List<ModelSelectionDto>,
    query: String,
): List<ModelPickerRow> {
    val q = query.trim()
    val all = items.filterNot(ModelText::small)
    val filtered = all.filter {
        ModelSearch.matches(q, it.display) || ModelSearch.matches(q, it.id) || ModelSearch.matches(q, it.providerName)
    }
    val recommended = filtered
        .filter { it.recommendedIndex != null }
        .sortedWith(compareBy<ModelPicker.Item> { it.recommendedIndex }.thenBy { it.display.lowercase() }.thenBy { it.id })
    val grouped = filtered
        .filter { it.recommendedIndex == null }
        .groupBy { it.provider }
        .toList()
        .sortedWith(compareBy<Pair<String, List<ModelPicker.Item>>> { ModelText.providerSort(it.first) })
    val out = mutableListOf<ModelPickerRow>()
    if (q.isBlank()) {
        val byKey = all.associateBy { it.key }
        val fav = favorites.map { "${it.providerID}/${it.modelID}" }.mapNotNull(byKey::get)
        if (fav.isNotEmpty()) {
            val section = KiloBundle.message("model.picker.favorites")
            out += fav.map { ModelPickerRow(it, section, favorite = true) }
        }
    }
    if (recommended.isNotEmpty()) {
        val section = KiloBundle.message("model.picker.recommended")
        out += recommended.map { ModelPickerRow(it, section, favorite = false) }
    }
    for ((_, list) in grouped) {
        val sorted = list.sortedWith(compareBy<ModelPicker.Item> { it.display.lowercase() }.thenBy { it.id })
        val label = sorted.firstOrNull()?.providerName ?: continue
        out += sorted.map { ModelPickerRow(it, label, favorite = false) }
    }
    return out
}

internal fun modelPickerIndex(rows: List<ModelPickerRow>, key: String?): Int {
    if (key == null) return -1
    return rows.indexOfFirst { it.item.key == key }
}

internal fun modelPickerIndex(rows: List<ModelPickerRow>, index: Int): Int {
    if (rows.isEmpty()) return -1
    return index.coerceIn(0, rows.lastIndex)
}

internal fun modelPickerSectionTitle(rows: List<ModelPickerRow>, index: Int): String? {
    val row = rows.getOrNull(index) ?: return null
    val section = row.section ?: return null
    val prev = rows.getOrNull(index - 1)
    return if (prev?.section != section) section else null
}
