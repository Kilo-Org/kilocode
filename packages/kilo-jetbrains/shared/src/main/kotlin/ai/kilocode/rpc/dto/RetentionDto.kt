package ai.kilocode.rpc.dto

import kotlinx.serialization.Serializable

@Serializable
data class RetentionPolicyDto(
    val enabled: Boolean = false,
    val maxAgeDays: Int = 30,
)

@Serializable
data class RetentionResultDto(
    val at: Long,
    val scanned: Int,
    val deleted: Int,
    val skippedActive: Int,
    val failed: Int,
    val durationMs: Long,
)

@Serializable
data class RetentionProgressDto(
    val phase: String,
    val total: Int,
    val processed: Int,
    val deleted: Int,
    val failed: Int,
    val skippedActive: Int,
)

@Serializable
data class RetentionStatusDto(
    val policy: RetentionPolicyDto = RetentionPolicyDto(),
    val last: RetentionResultDto? = null,
    val progress: RetentionProgressDto? = null,
)
