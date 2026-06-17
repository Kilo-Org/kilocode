package ai.kilocode.rpc.dto

import kotlinx.serialization.Serializable

@Serializable
data class ProviderSettingsDto(
    val providers: List<ProviderSettingsProviderDto> = emptyList(),
    val connected: List<String> = emptyList(),
    val defaults: Map<String, String> = emptyMap(),
    val auth: Map<String, List<ProviderAuthMethodDto>> = emptyMap(),
    val config: Map<String, CustomProviderConfigDto> = emptyMap(),
    val disabled: List<String> = emptyList(),
    val enabled: List<String> = emptyList(),
    val disabledScopes: Map<String, List<String>> = emptyMap(),
    val enabledScopes: Map<String, List<String>> = emptyMap(),
    val errors: List<LoadErrorDto> = emptyList(),
)

@Serializable
data class ProviderSettingsProviderDto(
    val id: String,
    val name: String,
    val description: String? = null,
    val source: String? = null,
    val key: String? = null,
    val metadata: ProviderMetadataDto? = null,
    val models: Map<String, ModelDto> = emptyMap(),
) {
    val custom: Boolean get() = source == "custom" || id in setOf("openai-compatible")
}

@Serializable
data class ProviderMetadataDto(
    val noteKey: String? = null,
    val icon: String? = null,
    val priority: Int? = null,
)

@Serializable
data class ProviderAuthMethodDto(
    val type: String,
    val label: String,
    val prompts: List<ProviderAuthPromptDto> = emptyList(),
)

@Serializable
data class ProviderAuthPromptDto(
    val key: String,
    val label: String,
    val type: String = "text",
    val options: List<ProviderAuthOptionDto> = emptyList(),
    val whenKey: String? = null,
    val whenOp: String? = null,
    val whenValue: String? = null,
)

@Serializable
data class ProviderAuthOptionDto(
    val label: String,
    val value: String = label,
)

@Serializable
data class ProviderConnectDto(
    val directory: String,
    val providerId: String,
    val key: String,
    val metadata: Map<String, String> = emptyMap(),
)

@Serializable
data class ProviderOAuthAuthorizeDto(
    val directory: String,
    val providerId: String,
    val method: String,
    val inputs: Map<String, String> = emptyMap(),
)

@Serializable
data class ProviderOAuthCallbackDto(
    val directory: String,
    val providerId: String,
    val method: String,
    val code: String? = null,
)

@Serializable
data class ProviderOAuthReadyDto(
    val url: String? = null,
    val method: String = "auto",
    val instructions: String? = null,
    val error: String? = null,
)

@Serializable
data class ProviderDisconnectDto(
    val directory: String,
    val providerId: String,
)

@Serializable
data class ProviderEnableDto(
    val directory: String,
    val providerId: String,
)

@Serializable
data class ProviderActionResultDto(
    val state: ProviderSettingsDto,
    val profileCleared: Boolean = false,
    val error: String? = null,
)

@Serializable
data class CustomProviderSaveDto(
    val directory: String,
    val id: String,
    val name: String,
    val baseUrl: String,
    val apiKey: String? = null,
    val envVar: String? = null,
    val headers: Map<String, String> = emptyMap(),
    val models: List<CustomModelDto> = emptyList(),
)

@Serializable
data class CustomModelDto(
    val id: String,
    val name: String = id,
    val reasoning: Boolean = false,
)

@Serializable
data class CustomModelFetchDto(
    val baseUrl: String,
    val apiKey: String? = null,
    val headers: Map<String, String> = emptyMap(),
)

@Serializable
data class CustomModelFetchResultDto(
    val models: List<String> = emptyList(),
    val error: String? = null,
)

@Serializable
data class CustomProviderConfigDto(
    val id: String,
    val name: String? = null,
    val npm: String? = null,
    val env: List<String> = emptyList(),
    val options: Map<String, String> = emptyMap(),
    val headers: Map<String, String> = emptyMap(),
    val models: Map<String, CustomModelDto> = emptyMap(),
    val scope: String = "global",
)
