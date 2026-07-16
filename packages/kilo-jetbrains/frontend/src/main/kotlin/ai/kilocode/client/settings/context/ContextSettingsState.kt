package ai.kilocode.client.settings.context

import ai.kilocode.rpc.dto.CompactionPatchDto
import ai.kilocode.rpc.dto.ConfigDto
import ai.kilocode.rpc.dto.ConfigPatchDto
import ai.kilocode.rpc.dto.WatcherPatchDto

internal data class ContextDraft(
    val auto: Boolean = false,
    val threshold: String = "",
    val prune: Boolean = false,
    val ignore: List<String> = emptyList(),
)

internal enum class ThresholdStatus {
    VALID,
    INVALID,
}

internal fun contextDraft(config: ConfigDto?): ContextDraft = ContextDraft(
    auto = config?.compaction?.auto ?: false,
    threshold = config?.compaction?.threshold_percent?.let(::formatThreshold).orEmpty(),
    prune = config?.compaction?.prune ?: false,
    ignore = config?.watcher?.ignore ?: emptyList(),
)

internal fun patch(from: ContextDraft, to: ContextDraft): ConfigPatchDto {
    if (thresholdStatus(to.threshold) == ThresholdStatus.INVALID) return ConfigPatchDto()

    val compaction = compactionPatch(from, to)
    val watcher = if (from.ignore != to.ignore) WatcherPatchDto(ignore = to.ignore) else null
    return ConfigPatchDto(watcher = watcher, compaction = compaction)
}

internal fun changed(patch: ConfigPatchDto): Boolean = patch.watcher != null || patch.compaction != null

internal fun savedMatches(base: ContextDraft, draft: ContextDraft): Boolean =
    base.auto == draft.auto &&
        normalizeThreshold(base.threshold) == normalizeThreshold(draft.threshold) &&
        base.prune == draft.prune &&
        base.ignore == draft.ignore

internal fun thresholdStatus(value: String): ThresholdStatus {
    val text = value.trim()
    if (text.isBlank()) return ThresholdStatus.VALID
    val num = text.toDoubleOrNull()
    if (num == null || !num.isFinite() || num < 0.0 || num > 100.0) return ThresholdStatus.INVALID
    return ThresholdStatus.VALID
}

private fun compactionPatch(from: ContextDraft, to: ContextDraft): CompactionPatchDto? {
    val clear = mutableListOf<String>()
    val threshold = parseThreshold(to.threshold)
    val fromThreshold = parseThreshold(from.threshold)
    if (fromThreshold != threshold && threshold == null) clear += "threshold_percent"
    val patch = CompactionPatchDto(
        clear = clear,
        auto = to.auto.takeIf { from.auto != to.auto },
        threshold_percent = threshold.takeIf { fromThreshold != threshold && threshold != null },
        prune = to.prune.takeIf { from.prune != to.prune },
    )
    if (patch.clear.isEmpty() && patch.auto == null && patch.threshold_percent == null && patch.prune == null) return null
    return patch
}

private fun parseThreshold(value: String): Double? {
    val text = value.trim()
    if (text.isBlank()) return null
    return text.toDoubleOrNull()?.takeIf { it.isFinite() && it >= 0.0 && it <= 100.0 }
}

private fun normalizeThreshold(value: String): String = parseThreshold(value)?.let(::formatThreshold).orEmpty()

private fun formatThreshold(value: Double): String {
    val whole = value.toLong()
    if (value == whole.toDouble()) return whole.toString()
    return value.toString()
}
