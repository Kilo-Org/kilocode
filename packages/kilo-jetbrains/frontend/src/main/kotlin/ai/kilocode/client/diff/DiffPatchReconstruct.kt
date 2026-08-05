package ai.kilocode.client.diff

import ai.kilocode.rpc.dto.DiffFileDto

internal data class DiffSides(
    val before: String,
    val after: String,
    val renderable: Boolean,
)

internal object DiffPatchReconstruct {
    private val HUNK = Regex("^@@ -\\d+(?:,(\\d+))? \\+\\d+(?:,(\\d+))? @@")

    fun sides(dto: DiffFileDto): DiffSides {
        val patch = dto.patch
        if (patch.isNullOrBlank() || binary(patch)) return DiffSides("", "", false)
        val before = StringBuilder()
        val after = StringBuilder()
        var hunks = 0
        var oldLen = 0
        var newLen = 0
        var oldSeen = 0
        var newSeen = 0
        // Drop the trailing empty element that split('\n') yields for a newline-terminated patch (the
        // usual case for git output). Counting it as a body line would inflate oldSeen/newSeen past the
        // header lengths and wrongly reject every full-context diff. Mirrors DiffLineNumbers' edge trim;
        // real blank context lines are " " (space-prefixed), never "", so no content is lost.
        for (line in patch.split('\n').dropLastWhile { it.isEmpty() }) {
            if (line.startsWith("@@")) {
                hunks += 1
                HUNK.find(line)?.let { match ->
                    oldLen += match.groupValues[1].ifEmpty { "1" }.toInt()
                    newLen += match.groupValues[2].ifEmpty { "1" }.toInt()
                }
                continue
            }
            if (hunks == 0) continue
            if (line.startsWith("\\")) continue
            when (line.firstOrNull()) {
                ' ' -> {
                    before.appendLine(line.substring(1))
                    after.appendLine(line.substring(1))
                    oldSeen += 1
                    newSeen += 1
                }
                '-' -> { before.appendLine(line.substring(1)); oldSeen += 1 }
                '+' -> { after.appendLine(line.substring(1)); newSeen += 1 }
                else -> {
                    before.appendLine("")
                    after.appendLine("")
                    oldSeen += 1
                    newSeen += 1
                }
            }
        }
        // Both producers (CLI snapshot and branchDiff) emit a single full-context hunk. A patch with
        // several hunks, or one whose header lengths don't match the reconstructed body, has elided
        // context: reconstructing would place every line at the wrong number, so fall back to the
        // raw-patch view (renderable = false) instead of showing a misaligned side-by-side diff.
        if (hunks != 1 || oldSeen != oldLen || newSeen != newLen) return DiffSides("", "", false)
        val left = if (added(patch)) "" else before.toString().removeSuffix("\n")
        val right = if (deleted(patch)) "" else after.toString().removeSuffix("\n")
        return DiffSides(left, right, true)
    }

    fun added(patch: String?): Boolean = patch?.lineSequence()?.any { it == "--- /dev/null" } == true

    fun deleted(patch: String?): Boolean = patch?.lineSequence()?.any { it == "+++ /dev/null" } == true

    private fun binary(patch: String): Boolean = patch.lineSequence().any { it.startsWith("Binary files ") }
}
