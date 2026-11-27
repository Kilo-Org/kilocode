package ai.kilocode.client.session.background

/** Lifecycle of a background subagent job, mirroring [ai.kilocode.rpc.dto.BackgroundJobDto.status]. */
enum class BackgroundAgentStatus { RUNNING, COMPLETED, CANCELLED, ERROR }

/**
 * One row in the background-agents strip, derived from a [ai.kilocode.rpc.dto.BackgroundJobDto].
 *
 * [job] is the job id — the cancel/dismiss key. [session] is the child session id — the key used to
 * open its transcript. For a `task`-tool job the CLI uses the child session id as the job id, so the
 * two are equal in practice, but they are kept distinct to match the wire shape.
 */
data class BackgroundAgent(
    val job: String,
    val session: String,
    val title: String?,
    val status: BackgroundAgentStatus,
    val error: String? = null,
    /** True when [session] has a pending permission request. See [BackgroundAgents.rows]. */
    val waiting: Boolean = false,
)
