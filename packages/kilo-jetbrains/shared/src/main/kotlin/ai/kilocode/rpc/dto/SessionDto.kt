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
    val cost: Double? = null,
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
data class SessionActivityDto(
    val kind: String,
    val requestID: String? = null,
    val message: String? = null,
)

@Serializable
data class SessionRuntimeDto(
    val statuses: Map<String, SessionStatusDto> = emptyMap(),
    val activities: Map<String, SessionActivityDto> = emptyMap(),
    val costs: Map<String, Double> = emptyMap(),
)

@Serializable
data class SessionListDto(
    val sessions: List<SessionDto>,
    val statuses: Map<String, SessionStatusDto>,
    val activities: Map<String, SessionActivityDto> = emptyMap(),
    val costs: Map<String, Double> = emptyMap(),
)
