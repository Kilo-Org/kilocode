package ai.kilocode.rpc.dto

import kotlinx.serialization.Serializable

@Serializable
data class SessionDto(
    val id: String,
    val projectID: String,
    val directory: String,
    val parentID: String? = null,
    val title: String,
    val version: String,
    val time: SessionTimeDto,
    val summary: SessionSummaryDto? = null,
    val revert: SessionRevertDto? = null,
    val share: SessionShareDto? = null,
)

/** Public share link for a session. Present only while the session is shared. */
@Serializable
data class SessionShareDto(
    val url: String,
)

@Serializable
data class SessionRevertDto(
    val messageID: String,
    val partID: String? = null,
    val snapshot: String? = null,
    val diff: String? = null,
    val diffs: List<DiffFileDto> = emptyList(),
)

@Serializable
data class SessionTimeDto(
    val created: Double,
    val updated: Double,
    val archived: Double? = null,
)

@Serializable
data class SessionSummaryDto(
    val additions: Int,
    val deletions: Int,
    val files: Int,
)

@Serializable
data class SessionStatusDto(
    val type: String,
    val message: String? = null,
    val attempt: Int? = null,
    val next: Long? = null,
    val requestID: String? = null,
)

@Serializable
enum class SessionActivityKindDto {
    RUNNING,
    QUESTION,
    PLAN,
    PERMISSION,
    ERROR,
}

@Serializable
data class SessionActivityDto(
    val directory: String,
    val kind: SessionActivityKindDto,
)

@Serializable
data class SessionListDto(
    val sessions: List<SessionDto>,
    val statuses: Map<String, SessionStatusDto>,
)

@Serializable
enum class SessionChangeKindDto {
    CREATED,
    UPDATED,
    DELETED,
}

/**
 * A session lifecycle change observed on the CLI event stream, tagged with the session's own
 * directory so directory-scoped views can decide whether it concerns them.
 *
 * The stream is app-wide: it carries changes for every directory this IDE's CLI serves, including
 * sessions started in another project frame.
 */
@Serializable
data class SessionChangeDto(
    val id: String,
    val directory: String,
    val kind: SessionChangeKindDto,
)
