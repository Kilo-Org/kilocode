package ai.kilocode.client.session.ui

interface SessionView {
    val sessionViewKind: Kind
    val sessionGapKind: Kind get() = sessionViewKind

    enum class Kind {
        Default,
        UserPrompt,
    }
}
