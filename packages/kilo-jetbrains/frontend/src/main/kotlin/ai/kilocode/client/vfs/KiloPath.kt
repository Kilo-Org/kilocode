package ai.kilocode.client.vfs

import kotlinx.serialization.Serializable

@Serializable
data class KiloPath(
    val kind: String,
    val params: Map<String, String> = emptyMap(),
) {
    fun canonical(): KiloPath = copy(params = canonicalParams(params))
}

internal fun canonicalParams(params: Map<String, String>): Map<String, String> {
    if (params.size < 2) return params
    return params.toSortedMap()
}
