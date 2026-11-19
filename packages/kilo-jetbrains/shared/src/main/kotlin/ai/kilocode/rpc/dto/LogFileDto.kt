package ai.kilocode.rpc.dto

import kotlinx.serialization.Serializable

/** Backend diagnostic log file contents, transferred to the frontend for download in split mode. */
@Serializable
data class LogFileDto(
    val name: String,
    val content: String,
)
