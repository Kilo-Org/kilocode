package ai.kilocode.client.session.model

/**
 * Sandbox confinement state for the session's prompt control.
 *
 * [Unknown] covers both "not fetched yet" and "feature/host not supported" — the prompt control
 * hides interactive actions in both cases and only distinguishes them via [reason] once [Known]
 * arrives (support probes return quickly, so a real UI is rarely stuck in [Unknown]).
 */
sealed class SandboxUiState {
    data object Unknown : SandboxUiState()

    /**
     * A concrete server-confirmed state. [enabled]/[available] are the *effective* state — a
     * desired-on policy whose backend became unavailable reports `enabled=false, available=false`
     * with [reason] explaining why, not an unrestricted fallback. [version] is a per-session policy
     * revision used to discard stale/out-of-order updates.
     */
    data class Known(
        val enabled: Boolean,
        val available: Boolean,
        val reason: String?,
        val version: Long,
        val pending: Boolean = false,
    ) : SandboxUiState()
}
