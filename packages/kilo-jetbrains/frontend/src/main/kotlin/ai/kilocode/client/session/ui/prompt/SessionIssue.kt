package ai.kilocode.client.session.ui.prompt

/** An actionable problem scoped to one chat session. */
internal data class SessionIssue(
    val id: String,
    val title: String,
    val actions: List<SessionIssueAction>,
)

/** One recovery path shown under a [SessionIssue] provider group. */
internal data class SessionIssueAction(
    val title: String,
    val description: String? = null,
    val enabled: Boolean = true,
    val action: () -> Unit,
)
