package ai.kilocode.client.settings.models

import ai.kilocode.rpc.dto.AgentConfigPatchDto
import ai.kilocode.rpc.dto.AgentDto
import ai.kilocode.rpc.dto.ConfigDto
import ai.kilocode.rpc.dto.ConfigPatchDto
import ai.kilocode.rpc.dto.LoadErrorDto
import ai.kilocode.rpc.dto.ProvidersDto

internal data class ModelsDraft(
    val model: String? = null,
    val small: String? = null,
    val agents: Map<String, String?> = emptyMap(),
)

internal fun modelsDraft(config: ConfigDto?, agents: List<AgentDto>): ModelsDraft = ModelsDraft(
    model = config?.model,
    small = config?.smallModel,
    agents = agents.associate { item -> item.name to config?.agent?.get(item.name)?.model },
)

internal fun patch(from: ModelsDraft, to: ModelsDraft): ConfigPatchDto {
    val values = linkedMapOf<String, String?>()
    if (from.model != to.model) values["model"] = to.model
    if (from.small != to.small) values["small_model"] = to.small

    val agents = linkedMapOf<String, AgentConfigPatchDto>()
    for (name in (from.agents.keys + to.agents.keys).sorted()) {
        if (from.agents[name] != to.agents[name]) {
            val model = to.agents[name]
            agents[name] = if (model == null) AgentConfigPatchDto(clear = listOf("model")) else AgentConfigPatchDto(model = model)
        }
    }
    return ConfigPatchDto(values = values, agents = agents)
}

internal fun parseSelection(key: String?): Pair<String, String>? {
    val idx = key?.indexOf('/') ?: return null
    if (idx <= 0 || idx >= key.length - 1) return null
    return key.substring(0, idx) to key.substring(idx + 1)
}

internal fun key(provider: String, model: String): String = "$provider/$model"

internal enum class ModelsStatus {
    UNAVAILABLE,
    LOADING,
    LOAD_FAILED,
    NO_PROVIDERS,
    MODES_FAILED,
    READY,
    SAVING,
}

internal fun modelsStatus(
    ready: Boolean,
    loading: Boolean,
    providers: ProvidersDto?,
    items: Int,
    errors: List<LoadErrorDto>,
    saving: Boolean,
): ModelsStatus {
    if (saving) return ModelsStatus.SAVING
    if (!ready) return ModelsStatus.UNAVAILABLE
    if (loading) return ModelsStatus.LOADING
    if (providers == null) return ModelsStatus.LOAD_FAILED
    if (items == 0) return ModelsStatus.NO_PROVIDERS
    if (errors.any { it.resource == "agents" }) return ModelsStatus.MODES_FAILED
    return ModelsStatus.READY
}

internal fun modelsLoginBannerVisible(ready: Boolean, authenticated: Boolean): Boolean = ready && !authenticated

internal fun savedMatches(base: ModelsDraft, draft: ModelsDraft): Boolean {
    if (base.model != draft.model) return false
    if (base.small != draft.small) return false
    for ((name, value) in draft.agents) {
        if (base.agents[name] != value) return false
    }
    return true
}
