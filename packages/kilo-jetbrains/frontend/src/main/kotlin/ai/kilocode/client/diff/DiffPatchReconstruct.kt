package ai.kilocode.client.diff

import ai.kilocode.rpc.dto.DiffFileDto

internal data class DiffSides(
    val before: String,
    val after: String,
    val renderable: Boolean,
    // 0-based source-file line for each reconstructed document line, so the diff editor gutter shows
    // real file positions (and jumps across the elided inter-hunk gaps) instead of restarting at 1.
    val leftLines: List<Int> = emptyList(),
    val rightLines: List<Int> = emptyList(),
)

internal object DiffPatchReconstruct {
    private val HUNK = Regex("^@@ -(\\d+)(?:,(\\d+))? \\+(\\d+)(?:,(\\d+))? @@")

    fun sides(dto: DiffFileDto): DiffSides {
        val patch = dto.patch
        if (patch.isNullOrBlank() || binary(patch)) return DiffSides("", "", false)
        val before = StringBuilder()
        val after = StringBuilder()
        val leftLines = mutableListOf<Int>()
        val rightLines = mutableListOf<Int>()
        var hunks = 0
        var oldLen = 0
        var newLen = 0
        var oldSeen = 0
        var newSeen = 0
        var oldLine = 1
        var newLine = 1
        // Drop the trailing empty element that split('\n') yields for a newline-terminated patch (the
        // usual case for git output). Counting it as a body line would inflate oldSeen/newSeen past the
        // header lengths and wrongly reject every full-context diff. Mirrors DiffLineNumbers' edge trim;
        // real blank context lines are " " (space-prefixed), never "", so no content is lost.
        for (line in patch.split('\n').dropLastWhile { it.isEmpty() }) {
            if (line.startsWith("@@")) {
                hunks += 1
                HUNK.find(line)?.let { match ->
                    oldLine = match.groupValues[1].toInt()
                    newLine = match.groupValues[3].toInt()
                    oldLen += match.groupValues[2].ifEmpty { "1" }.toInt()
                    newLen += match.groupValues[4].ifEmpty { "1" }.toInt()
                }
                continue
            }
            if (hunks == 0) continue
            if (line.startsWith("\\")) continue
            when (line.firstOrNull()) {
                ' ' -> {
                    before.appendLine(line.substring(1)); leftLines.add(oldLine++ - 1)
                    after.appendLine(line.substring(1)); rightLines.add(newLine++ - 1)
                    oldSeen += 1
                    newSeen += 1
                }
                '-' -> { before.appendLine(line.substring(1)); leftLines.add(oldLine++ - 1); oldSeen += 1 }
                '+' -> { after.appendLine(line.substring(1)); rightLines.add(newLine++ - 1); newSeen += 1 }
                else -> {
                    before.appendLine(""); leftLines.add(oldLine++ - 1)
                    after.appendLine(""); rightLines.add(newLine++ - 1)
                    oldSeen += 1
                    newSeen += 1
                }
            }
        }
        // A patch may carry several hunks (limited-context git output) or a single full-context hunk.
        // We concatenate every hunk body into contiguous before/after text: unchanged context lines
        // anchor each region so the resulting side-by-side still colors adds/removes correctly. The
        // elided gaps between hunks collapse (line numbers restart at 1), which is acceptable for a
        // "what changed" view and far better than the all-green raw-patch fallback. We still bail when
        // there is no hunk, or when the header lengths don't match the reconstructed body (truncated
        // context), because that would place lines against the wrong side.
        if (hunks < 1 || oldSeen != oldLen || newSeen != newLen) return DiffSides("", "", false)
        val added = added(patch)
        val deleted = deleted(patch)
        val left = if (added) "" else before.toString().removeSuffix("\n")
        val right = if (deleted) "" else after.toString().removeSuffix("\n")
        return DiffSides(
            left,
            right,
            true,
            if (added) emptyList() else leftLines,
            if (deleted) emptyList() else rightLines,
        )
    }

    fun added(patch: String?): Boolean = patch?.lineSequence()?.any { it == "--- /dev/null" } == true

    fun deleted(patch: String?): Boolean = patch?.lineSequence()?.any { it == "+++ /dev/null" } == true

    private fun binary(patch: String): Boolean = patch.lineSequence().any { it.startsWith("Binary files ") }
}
