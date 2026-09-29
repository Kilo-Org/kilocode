package ai.kilocode.client.session.ui.prompt

import javax.swing.Icon

/** An actionable problem scoped to one chat session. */
internal data class SessionIssue(
    val id: String,
    val title: String,
    val description: String? = null,
    val icon: Icon? = null,
    val enabled: Boolean = true,
    val action: () -> Unit,
)
