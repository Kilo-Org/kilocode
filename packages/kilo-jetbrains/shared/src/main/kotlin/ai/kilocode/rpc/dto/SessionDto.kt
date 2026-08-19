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
