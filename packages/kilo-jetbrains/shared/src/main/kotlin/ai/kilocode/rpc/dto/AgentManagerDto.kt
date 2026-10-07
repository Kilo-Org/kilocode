package ai.kilocode.rpc.dto

import kotlinx.serialization.Serializable

/**
 * Progress for one task of a host-initiated `agent_manager` `start` request (worktree/session
 * creation requested by a chat via the `agent_manager` tool, not by the user through the New
 * Worktree dialog).
 *
 * Deliberately module-local to the wire protocol in `backend/` — only this progress projection
 * crosses the RPC boundary. The request/response wire types that parse
 * `kilocode.agent_manager.*` SSE events stay backend-only; sending them through shared `@Serializable`
 * classes would call a shared DTO's generated kotlinx serializer from two different classloaders in
 * split mode (see the JetBrains architecture skill).
 */
@Serializable
data class AgentManagerStartProgressDto(
    /** The `agent_manager` tool's `request_id`, echoed in its tool output. */
    val requestID: String,
    val stage: AgentManagerStartStage,
    /** Set once the worktree exists (worktree mode only). */
    val worktreeID: String? = null,
    /** Set once the session exists. */
    val sessionID: String? = null,
    /** Set when [stage] is [AgentManagerStartStage.FAILED]. */
    val error: String? = null,
)

@Serializable
enum class AgentManagerStartStage { PREPARING, READY, FAILED }
