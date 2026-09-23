package ai.kilocode.rpc.dto

import kotlinx.serialization.Serializable

/** Backend host sandbox capability for a directory, from `GET /sandbox/support`. */
@Serializable
data class SandboxSupportDto(
    val available: Boolean,
    val reason: String? = null,
)

/**
 * Effective sandbox confinement state for one session, from `GET /session/{id}/sandbox`,
 * `POST /session/{id}/sandbox/toggle`, and the `sandbox.status.changed` SSE event.
 *
 * [version] is a per-session policy revision, not a global event sequence — a client must ignore a
 * status/event whose [version] is lower than one it already applied for the same session.
 * [enabled] is the *effective* state (stored enabled AND backend available): a desired-on policy
 * whose backend became unavailable reports `enabled=false, available=false`, not an unrestricted
 * fallback — tool execution fails closed instead.
 */
@Serializable
data class SandboxStatusDto(
    val sessionID: String,
    val directory: String,
    val enabled: Boolean,
    val available: Boolean,
    val reason: String? = null,
    val version: Long,
)

/** Outbound network policy for sandboxed tools, matching the CLI's `sandbox.network` config. */
@Serializable
enum class SandboxNetworkDto { ALLOW, DENY }

/**
 * Global sandbox policy, matching the CLI's `sandbox` config object.
 *
 * [enabled] is intentionally nullable so JetBrains can distinguish "unset" (exposes controls on
 * supported hosts, per-session default resolves to off) from an explicit `false` (hides
 * interactive controls entirely) — the CLI/config schema makes the same distinction.
 */
@Serializable
data class SandboxConfigDto(
    val enabled: Boolean? = null,
    val network: SandboxNetworkDto? = null,
    val writablePaths: List<String> = emptyList(),
    val allowedHosts: List<String> = emptyList(),
)

/** Patch for [SandboxConfigDto]; a null field is left unchanged by the CLI. */
@Serializable
data class SandboxConfigPatchDto(
    val enabled: Boolean? = null,
    val network: SandboxNetworkDto? = null,
    val writablePaths: List<String>? = null,
    val allowedHosts: List<String>? = null,
)
