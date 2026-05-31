package ai.kilocode.rpc.dto

import kotlinx.serialization.Serializable

@Serializable
data class WorkspaceFileDto(
    val path: String,
    val name: String,
    val directory: Boolean = false,
)
