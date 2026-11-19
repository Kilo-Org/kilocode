package ai.kilocode.backend.session

import ai.kilocode.rpc.dto.DiffFileDto

/** Decode a full-context server patch; never fill gaps in a historical diff from today's working tree. */
internal fun fullFileSides(file: DiffFileDto): DiffFileDto? {
    val patch = file.patch ?: return null
    val lines = patch.split('\n')
    val start = lines.indexOfFirst { it.startsWith("@@ ") }
    if (start < 0) return null
    val header = Regex("^@@ -(\\d+)(?:,(\\d+))? \\+(\\d+)(?:,(\\d+))? @@.*").matchEntire(lines[start]) ?: return null
    if (header.groupValues[1].toInt() > 1 || header.groupValues[3].toInt() > 1) return null
    val left = StringBuilder(); val right = StringBuilder()
    var prior = ' '; var oldCount = 0; var newCount = 0
    for (i in start + 1 until lines.size) {
        val line = lines[i]
        if (line.isEmpty() && i == lines.lastIndex) break
        if (line == "\\ No newline at end of file") {
            if (prior != '+' && left.endsWith("\n")) left.deleteCharAt(left.lastIndex)
            if (prior != '-' && right.endsWith("\n")) right.deleteCharAt(right.lastIndex)
            continue
        }
        prior = line.firstOrNull() ?: return null
        if (prior !in " +-") return null
        if (prior != '+') { left.appendLine(line.substring(1)); oldCount++ }
        if (prior != '-') { right.appendLine(line.substring(1)); newCount++ }
    }
    if (oldCount != header.groupValues[2].ifEmpty { "1" }.toInt() || newCount != header.groupValues[4].ifEmpty { "1" }.toInt()) return null
    return file.copy(before = left.toString(), after = right.toString())
}
