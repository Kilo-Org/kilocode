package ai.kilocode.backend.diff

/**
 * Rebuilds the full "before" content of a modified file by reverse-applying a unified diff hunk
 * patch to the current working-tree content. This lets the JetBrains diff editor show a whole-file
 * diff (with collapsible unchanged regions) from the limited-context patch the CLI already returns —
 * no CLI change required.
 *
 * Added and deleted files are intentionally rejected: their patches already carry every line, so the
 * frontend reconstructs those full sides directly. Binary patches and any drift between the patch's
 * after side and the real file (a stale/historical turn) also return null so the caller can fall back
 * to the hunk-only view instead of rendering a wrong diff.
 *
 * Known limitation: `\ No newline at end of file` markers are dropped rather than tracked per side, so
 * the reconstructed `before` inherits the after side's trailing-newline state. When exactly one side
 * lacks a trailing newline, the whole-file fallback view will not surface that EOF-newline change. This
 * is cosmetic and rare (the scoped hunk view still shows the marker); tracking it per side would require
 * remembering which side the marker followed.
 */
internal object DiffFullReconstruct {
    private val HUNK = Regex("^@@ -\\d+(?:,\\d+)? \\+(\\d+)(?:,(\\d+))? @@")

    fun before(after: String, patch: String?): String? {
        if (patch.isNullOrBlank() || binary(patch) || added(patch) || deleted(patch)) return null

        val lines = if (after.isEmpty()) emptyList() else after.split("\n")
        val out = ArrayList<String>(lines.size)
        var cursor = 0 // next after-line index still to emit (0-based)
        var open = false
        var start = 0 // 0-based after index where the current hunk begins
        val afterBody = ArrayList<String>()
        val beforeBody = ArrayList<String>()

        fun flush(): Boolean {
            if (!open) return true
            if (start < cursor) return false // overlapping or out-of-order hunks
            while (cursor < start) {
                if (cursor >= lines.size) return false
                out.add(lines[cursor]); cursor++
            }
            for (i in afterBody.indices) {
                val idx = start + i
                if (idx >= lines.size || lines[idx] != afterBody[i]) return false // working tree drifted
            }
            out.addAll(beforeBody)
            cursor = start + afterBody.size
            afterBody.clear(); beforeBody.clear()
            open = false
            return true
        }

        // git patches are newline-terminated; drop the trailing split artifact so it is not read as a
        // blank context line. Real blank context lines are " " (space-prefixed), never "".
        for (raw in patch.split("\n").dropLastWhile { it.isEmpty() }) {
            if (raw.startsWith("@@")) {
                if (!flush()) return null
                val match = HUNK.find(raw) ?: return null
                val newStart = match.groupValues[1].toIntOrNull() ?: return null
                val newLen = match.groupValues[2].ifEmpty { "1" }.toInt()
                // For a zero-length new range git reports the line preceding the removed block, so the
                // removed lines are reinserted at `newStart`; otherwise the region starts at newStart-1.
                start = if (newLen == 0) newStart else newStart - 1
                open = true
                continue
            }
            if (!open) continue // skip file headers (diff/index/---/+++)
            if (raw.startsWith("\\")) continue // "\ No newline at end of file"
            when (raw.firstOrNull()) {
                ' ' -> { val body = raw.substring(1); afterBody.add(body); beforeBody.add(body) }
                '+' -> afterBody.add(raw.substring(1))
                '-' -> beforeBody.add(raw.substring(1))
                null -> { afterBody.add(""); beforeBody.add("") }
                else -> return null
            }
        }
        if (!flush()) return null
        while (cursor < lines.size) { out.add(lines[cursor]); cursor++ }
        return out.joinToString("\n")
    }

    fun added(patch: String): Boolean = patch.lineSequence().any { it == "--- /dev/null" }

    fun deleted(patch: String): Boolean = patch.lineSequence().any { it == "+++ /dev/null" }

    private fun binary(patch: String): Boolean = patch.lineSequence().any { it.startsWith("Binary files ") }
}
