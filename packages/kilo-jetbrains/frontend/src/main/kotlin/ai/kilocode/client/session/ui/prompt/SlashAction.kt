package ai.kilocode.client.session.ui.prompt

data class SlashAction(
    val name: String,
    val description: String,
    val hints: List<String> = emptyList(),
    val action: () -> Unit,
) {
    data class Spec(
        val name: String,
        val descriptionKey: String,
        val hints: List<String> = emptyList(),
    )

    companion object {
        val NEW = Spec("new", "prompt.slash.new", listOf("clear"))
        val SESSIONS = Spec("sessions", "prompt.slash.sessions", listOf("history", "resume", "continue"))
        val MODELS = Spec("models", "prompt.slash.models")
        val AGENTS = Spec("agents", "prompt.slash.agents", listOf("modes"))
        val VARIANT = Spec("variant", "prompt.slash.variant", listOf("reasoning", "variants", "thinking"))
        val COMPACT = Spec("compact", "prompt.slash.compact", listOf("smol", "condense"))
        val SETTINGS = Spec("settings", "prompt.slash.settings")
        val HELP = Spec("help", "prompt.slash.help")

        val ALL = listOf(
            NEW,
            SESSIONS,
            MODELS,
            AGENTS,
            VARIANT,
            COMPACT,
            SETTINGS,
            HELP,
        )
    }
}
