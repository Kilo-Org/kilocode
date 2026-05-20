package normalization

internal data class DuplicateTagRule(
    val original: String,
    val dedups: Array<TagDedup>,
)

internal data class TagDedup(
    val name: String,
    val ops: Array<String> = emptyArray(),
)

internal val duplicateTagRules = arrayOf(
    DuplicateTagRule(
        original = "pty",
        dedups = arrayOf(
            TagDedup(name = "pty"),
            TagDedup(
                name = "pty-connect",
                ops = arrayOf("pty.connect"),
            ),
        ),
    ),
)
