package ai.kilocode.client.session.ui.prompt

import ai.kilocode.rpc.dto.FileSearchResultDto

data class MentionAction(
    val name: String,
    val description: String,
    val hints: List<String> = emptyList(),
    val available: (FileSearchResultDto) -> Boolean,
) {
    data class Spec(
        val name: String,
        val descriptionKey: String,
        val hints: List<String> = emptyList(),
        val filename: String,
        val uri: String,
        val available: (FileSearchResultDto) -> Boolean,
    ) {
        val token: String get() = "@$name"
    }

    companion object {
        val GIT_CHANGES = Spec(
            "git-changes",
            "prompt.mention.gitChanges",
            filename = "git-changes.txt",
            uri = "git-changes",
            available = { it.git },
        )

        val ALL = listOf(GIT_CHANGES)
    }
}
