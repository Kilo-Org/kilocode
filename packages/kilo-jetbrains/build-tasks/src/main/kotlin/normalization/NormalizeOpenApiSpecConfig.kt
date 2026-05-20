package normalization

internal data class DuplicateTagRule(
    val original: String,
    val dedups: List<TagDedup>,
)

internal data class TagDedup(
    val name: String,
    val ops: List<String> = emptyList(),
)

internal val duplicateTagRules = listOf(
    DuplicateTagRule(
        original = "pty",
        dedups = listOf(
            TagDedup(name = "pty"),
            TagDedup(
                name = "pty-connect",
                ops = listOf("pty.connect"),
            ),
        ),
    ),
)
