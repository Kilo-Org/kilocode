package ai.kilocode.client.diff

import ai.kilocode.rpc.dto.DiffFileDto

internal data class DiffSides(
    val before: String,
    val after: String,
    val renderable: Boolean,
)

internal object DiffPatchReconstruct {
    fun sides(dto: DiffFileDto): DiffSides {
        val patch = dto.patch
        if (patch.isNullOrBlank() || binary(patch)) return DiffSides("", "", false)
        val before = StringBuilder()
        val after = StringBuilder()
        var hunk = false
        for (line in patch.split('\n')) {
            if (line.startsWith("@@")) {
                hunk = true
                continue
            }
            if (!hunk) continue
            if (line.startsWith("\\")) continue
            when (line.firstOrNull()) {
                ' ' -> {
                    before.appendLine(line.substring(1))
                    after.appendLine(line.substring(1))
                }
                '-' -> before.appendLine(line.substring(1))
                '+' -> after.appendLine(line.substring(1))
                else -> {
                    before.appendLine("")
                    after.appendLine("")
                }
            }
        }
        if (!hunk) return DiffSides("", "", false)
        val left = if (added(patch)) "" else before.toString().removeSuffix("\n")
        val right = if (deleted(patch)) "" else after.toString().removeSuffix("\n")
        return DiffSides(left, right, true)
    }

    fun added(patch: String?): Boolean = patch?.lineSequence()?.any { it == "--- /dev/null" } == true

    fun deleted(patch: String?): Boolean = patch?.lineSequence()?.any { it == "+++ /dev/null" } == true

    private fun binary(patch: String): Boolean = patch.lineSequence().any { it.startsWith("Binary files ") }
}
