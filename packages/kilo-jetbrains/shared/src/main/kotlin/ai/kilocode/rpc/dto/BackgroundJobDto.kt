package ai.kilocode.rpc.dto

import kotlinx.serialization.Serializable

/**
 * One background subagent job, as returned by `GET /kilocode/background-jobs`.
 *
 * [sessionId], [parentSessionId], and [background] are flattened out of the CLI's open
 * `metadata: Record<string, unknown>` map at the backend boundary (see
 * `ai.kilocode.backend.cli.KiloCliDataParser.parseBackgroundJobs`), so the frontend never parses an
 * untyped map. For a `task`-tool job, [id] equals [sessionId] — the CLI uses the child session id as
 * the job id.
 */
@Serializable
data class BackgroundJobDto(
    val id: String,
    val type: String,
    val status: String,
    val title: String? = null,
    val startedAt: Long = 0,
    val completedAt: Long? = null,
    val error: String? = null,
    val sessionId: String? = null,
    val parentSessionId: String? = null,
    val background: Boolean = false,
)
