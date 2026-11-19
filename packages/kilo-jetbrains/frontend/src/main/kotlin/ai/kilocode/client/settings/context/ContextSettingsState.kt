package ai.kilocode.client.settings.context

import ai.kilocode.client.plugin.KiloPluginSettings
import ai.kilocode.rpc.dto.CompactionPatchDto
import ai.kilocode.rpc.dto.ConfigDto
import ai.kilocode.rpc.dto.ConfigPatchDto
import ai.kilocode.rpc.dto.WatcherPatchDto

internal data class ContextDraft(
    val auto: Boolean = true,
    val threshold: String = "",
    val editor: Boolean = KiloPluginSettings.getAutoEditorContext(),
    val ignore: List<String> = emptyList(),
)

internal enum class ThresholdStatus {
    VALID,
    INVALID,
}

internal fun contextDraft(config: ConfigDto?): ContextDraft = ContextDraft(
    auto = config?.compaction?.auto ?: true,
    threshold = config?.compaction?.threshold_percent?.let(::formatThreshold).orEmpty(),
    editor = KiloPluginSettings.getAutoEditorContext(),
    ignore = config?.watcher?.ignore ?: emptyList(),
)

internal fun patch(from: ContextDraft, to: ContextDraft): ConfigPatchDto? {
    if (thresholdStatus(to.threshold) == ThresholdStatus.INVALID) return null

    val compaction = compactionPatch(from, to)
    val watcher = if (from.ignore != to.ignore) WatcherPatchDto(ignore = to.ignore) else null
    return ConfigPatchDto(watcher = watcher, compaction = compaction)
}

internal fun changed(patch: ConfigPatchDto): Boolean = patch.watcher != null || patch.compaction != null

internal fun savedMatches(base: ContextDraft, draft: ContextDraft): Boolean =
    base.auto == draft.auto &&
        normalizeThreshold(base.threshold) == normalizeThreshold(draft.threshold) &&
        base.editor == draft.editor &&
        base.ignore == draft.ignore

internal fun localChanged(base: ContextDraft, draft: ContextDraft): Boolean = base.editor != draft.editor

internal fun thresholdStatus(value: String): ThresholdStatus {
    val text = value.trim()
    if (text.isBlank()) return ThresholdStatus.VALID
    return if (parseThreshold(text) != null) ThresholdStatus.VALID else ThresholdStatus.INVALID
}

private fun compactionPatch(from: ContextDraft, to: ContextDraft): CompactionPatchDto? {
    val threshold = parseThreshold(to.threshold)
    val fromThreshold = parseThreshold(from.threshold)
    val clear = if (fromThreshold != threshold && threshold == null) listOf("threshold_percent") else emptyList()
    val patch = CompactionPatchDto(
        clear = clear,
        auto = to.auto.takeIf { from.auto != to.auto },
        threshold_percent = threshold.takeIf { fromThreshold != threshold && threshold != null },
    )
    if (patch.clear.isEmpty() && patch.auto == null && patch.threshold_percent == null) return null
    return patch
}

private fun parseThreshold(value: String): Double? {
    val text = value.trim()
    if (text.isBlank()) return null
    return text.toDoubleOrNull()?.takeIf { it in 1.0..100.0 }
}

private fun normalizeThreshold(value: String): String = parseThreshold(value)?.let(::formatThreshold).orEmpty()

private fun formatThreshold(value: Double): String {
    val whole = value.toLong()
    if (value == whole.toDouble()) return whole.toString()
    return value.toString()
}
