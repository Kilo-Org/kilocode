package ai.kilocode.rpc.dto

import kotlinx.serialization.Serializable

@Serializable
data class MarketplaceParamDto(
    val name: String,
    val key: String,
    val placeholder: String? = null,
    val optional: Boolean = false,
)

@Serializable
data class MarketplaceMethodDto(
    val name: String,
    val prerequisites: List<String> = emptyList(),
    val parameters: List<MarketplaceParamDto> = emptyList(),
)

// `content` carries the marketplace catalog item's raw `content` field as JSON text
// (a string for skills, an AgentContent object for agents, a string or an array of
// installation methods for MCP servers) so it can be replayed verbatim on install
// without the frontend needing to understand its shape.
@Serializable
data class MarketplaceItemDto(
    val id: String,
    val type: String,
    val name: String,
    val description: String,
    val category: String,
    val author: String? = null,
    val authorUrl: String? = null,
    val url: String? = null,
    val githubUrl: String? = null,
    val prerequisites: List<String> = emptyList(),
    val parameters: List<MarketplaceParamDto> = emptyList(),
    val methods: List<MarketplaceMethodDto> = emptyList(),
    val content: String,
    val installedProject: Boolean = false,
    val installedGlobal: Boolean = false,
    val relevant: Boolean = false,
)

@Serializable
data class MarketplaceListDto(
    val items: List<MarketplaceItemDto> = emptyList(),
    val errors: List<String> = emptyList(),
)

@Serializable
data class MarketplaceResultDto(
    val success: Boolean,
    val slug: String,
    val error: String? = null,
    val filePath: String? = null,
    val line: Int? = null,
)
