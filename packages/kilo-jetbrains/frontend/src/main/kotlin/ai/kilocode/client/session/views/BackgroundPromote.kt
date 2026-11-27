package ai.kilocode.client.session.views

/**
 * "Continue in background" wiring for a task card, pairing the action with a live availability check.
 *
 * [available] is re-read every time a card syncs rather than captured once, because the CLI's
 * background-subagent capability is only known after the connection load completes and can change on
 * reconnect, while task cards are created as parts stream in. Binding the gate to the action keeps a
 * call site from wiring one without the other.
 */
class BackgroundPromote(
    private val available: () -> Boolean,
    private val promote: (String) -> Unit,
) {
    /** Whether the connected CLI allows promoting a foreground subagent to the background. */
    fun available(): Boolean = available.invoke()

    /** Promotes the subagent owning child session [session]. */
    fun promote(session: String) = promote.invoke(session)
}
