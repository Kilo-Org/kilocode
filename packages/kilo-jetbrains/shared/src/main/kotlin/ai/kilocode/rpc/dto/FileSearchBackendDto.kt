package ai.kilocode.rpc.dto

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
enum class FileSearchBackendDto {
    @SerialName("kilo")
    KILO,

    @SerialName("intellij")
    INTELLIJ,
}
