package ai.kilocode.rpc.dto

import kotlinx.serialization.Serializable

/**
 * Composite identities for hosted Cloud sessions.
 *
 * A provider's native session id is only unique inside one workspace, so the local API and every
 * frontend cache key hosted sessions by `hosted:<provider>:<workspace>:<native-session>`.
 * Workspace-scoped calls use `hosted:<provider>:<workspace>`. These strings are routing/identity
 * values, never filesystem paths or Cloud API credentials.
 */
object HostedIDs {
    const val PREFIX = "hosted"

    fun workspace(providerID: String, workspaceID: String): String = "$PREFIX:$providerID:$workspaceID"

    fun session(providerID: String, workspaceID: String, sessionID: String): String =
        "${workspace(providerID, workspaceID)}:$sessionID"

    fun isWorkspace(value: String?): Boolean =
        value != null && parseWorkspace(value) != null

    fun isSession(value: String?): Boolean =
        value != null && parseSession(value) != null

    fun parseWorkspace(value: String): Pair<String, String>? {
        val parts = value.split(":")
        if (parts.size != 3 || parts.any { it.isBlank() } || parts[0] != PREFIX) return null
        return parts[1] to parts[2]
    }

    fun parseSession(value: String): Triple<String, String, String>? {
        val parts = value.split(":", limit = 4)
        if (parts.size != 4 || parts[0] != PREFIX) return null
        val provider = parts[1].takeIf { it.isNotBlank() } ?: return null
        val workspace = parts[2].takeIf { it.isNotBlank() } ?: return null
        val session = parts[3].takeIf { it.isNotBlank() } ?: return null
        return Triple(provider, workspace, session)
    }
}

@Serializable
data class HostedProviderDto(
    val id: String,
    val default: Boolean,
    val available: Boolean,
    val reason: String? = null,
    val message: String? = null,
)

@Serializable
data class HostedWorkspaceRefDto(
    val providerID: String,
    val workspaceID: String,
) {
    val key: String get() = HostedIDs.workspace(providerID, workspaceID)

    companion object {
        fun parse(value: String): HostedWorkspaceRefDto? {
            val (provider, workspace) = HostedIDs.parseWorkspace(value) ?: return null
            return HostedWorkspaceRefDto(provider, workspace)
        }
    }
}

@Serializable
data class HostedWorkspaceSessionDto(
    val id: String,
    val nativeSessionID: String,
    val title: String? = null,
    val createdOnPlatform: String = "",
    val created: Double = 0.0,
    val updated: Double = 0.0,
)

@Serializable
data class HostedWorkspaceDto(
    val ref: HostedWorkspaceRefDto,
    val name: String? = null,
    val repositoryUrl: String? = null,
    val branch: String? = null,
    val profileID: String? = null,
    val deletionState: String = "active",
    val created: Double = 0.0,
    val updated: Double = 0.0,
    val lastActivity: Double = 0.0,
    val sessions: List<HostedWorkspaceSessionDto> = emptyList(),
    val sessionCursor: String? = null,
    val computeStatus: String? = null,
    val computeDetail: String? = null,
    val estimatedSleepAt: Double? = null,
    val rateMicrodollarsPerHour: Long? = null,
    val activeSessionCount: Int = 0,
)

@Serializable
data class HostedWorkspaceListDto(
    val items: List<HostedWorkspaceDto> = emptyList(),
    val cursor: String? = null,
    val providers: List<HostedProviderDto> = emptyList(),
    val signedOut: Boolean = false,
)

@Serializable
data class HostedWorkspaceStatusDto(
    val ref: HostedWorkspaceRefDto,
    val deletionState: String,
    val computeStatus: String,
    val computeDetail: String,
    val observedAt: Double,
    val estimatedSleepAt: Double? = null,
    val activeSessionCount: Int = 0,
    val hasActiveTurn: Boolean = false,
    val wakeAvailable: Boolean = false,
    val wakeBlockedReason: String? = null,
    val rateMicrodollarsPerHour: Long? = null,
    val billingBlocked: Boolean? = null,
)

/**
 * The native routes Session Host can actually serve for a hosted session. Local-only operations
 * (Git/PR/file/terminal/run/fork/compact/revert/share) stay disabled in the UI.
 */
@Serializable
data class HostedCapabilitiesDto(
    val prompt: Boolean = true,
    val command: Boolean = true,
    val abort: Boolean = true,
    val questions: Boolean = true,
    val permissions: Boolean = true,
    val diff: Boolean = true,
    val todo: Boolean = true,
    val history: Boolean = true,
)

/**
 * Decoded `cloudAgent.systemEvents` preparation/status event. [sessionID] is the composite hosted
 * identity; the raw provider session id and directory never cross the backend boundary.
 * [observedAt] belongs only to [kind]'s clock: preparation timestamp or sandbox observation.
 * A zero clock is unknown; [revision] orders progress within [attemptID].
 */
@Serializable
data class HostedSystemEventDto(
    val sessionID: String,
    val kind: String,
    val step: String? = null,
    val action: String? = null,
    val message: String? = null,
    val cloudStatus: String? = null,
    val sandboxStatus: String? = null,
    val sandboxDetail: String? = null,
    val observedAt: Double = 0.0,
    val attemptID: String? = null,
    val revision: Long? = null,
    /** Explicit provider safe-error code only; never a raw server error or progress detail. */
    val failure: String? = null,
    val triggerMessageID: String? = null,
)
