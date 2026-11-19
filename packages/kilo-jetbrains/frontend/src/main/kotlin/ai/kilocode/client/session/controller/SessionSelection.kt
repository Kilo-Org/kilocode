package ai.kilocode.client.session.controller

import ai.kilocode.rpc.dto.AgentsDto
import ai.kilocode.rpc.dto.ConfigDto
import ai.kilocode.rpc.dto.ModelSelectionDto
import ai.kilocode.rpc.dto.ModelStateDto
import ai.kilocode.rpc.dto.ProvidersDto

internal const val KILO_PROVIDER = "kilo"
private const val KILO_AUTO_MODEL = "kilo-auto/free"

internal val ModelSelectionDto.key: String get() = "$providerID/$modelID"

/** Resolves the mode a blank session starts in. */
internal fun resolveSessionAgent(agents: AgentsDto?, remembered: String?): String? {
    if (remembered == null) return agents?.default
    val offered = agents?.agents ?: return remembered
    return if (offered.any { it.name == remembered }) remembered else agents.default
}

/** Resolves the model a blank session would use without its persisted per-agent override. */
internal fun resolveSessionDefaultModel(
    providers: ProvidersDto?,
    agent: String,
    state: ModelStateDto,
    config: ConfigDto?,
    ready: Boolean,
    first: ModelSelectionDto?,
): ModelSelectionDto? {
    if (ready) return resolveModelSelection(
        providers = providers,
        mode = config?.agent?.get(agent)?.model?.let(::modelSelection),
        global = config?.model?.let(::modelSelection),
        recent = state.recent,
    )
    return resolveModelSelection(
        providers = providers,
        mode = providers?.defaults?.get(agent)?.let(::modelSelection),
        global = providers?.defaults?.values?.firstNotNullOfOrNull(::modelSelection),
        fallback = null,
    ) ?: first
}

/** Resolves the effective model for a blank session, including its persisted per-agent override. */
internal fun resolveSessionModel(
    providers: ProvidersDto?,
    agent: String,
    state: ModelStateDto,
    config: ConfigDto?,
    default: ModelSelectionDto?,
): ModelSelectionDto? {
    val saved = state.model[agent]
    if (config != null) return resolveModelSelection(
        providers = providers,
        override = saved,
        mode = config.agent[agent]?.model?.let(::modelSelection),
        global = config.model?.let(::modelSelection),
        recent = state.recent,
    )
    if (saved != null) return validModelSelection(providers, saved) ?: default
    return default
}

private fun resolveModelSelection(
    providers: ProvidersDto?,
    override: ModelSelectionDto? = null,
    mode: ModelSelectionDto? = null,
    global: ModelSelectionDto? = null,
    recent: List<ModelSelectionDto> = emptyList(),
    fallback: ModelSelectionDto? = ModelSelectionDto(KILO_PROVIDER, KILO_AUTO_MODEL),
): ModelSelectionDto? {
    validModelSelection(providers, override)?.let { return it }
    validModelSelection(providers, mode)?.let { return it }
    validModelSelection(providers, global)?.let { return it }
    recent.firstNotNullOfOrNull { validModelSelection(providers, it) }?.let { return it }
    return fallback
}

internal fun validModelSelection(providers: ProvidersDto?, item: ModelSelectionDto?): ModelSelectionDto? {
    if (item == null) return null
    val list = providers?.providers ?: return item
    if (list.isEmpty()) return item
    val provider = list.firstOrNull { it.id == item.providerID } ?: return null
    if (item.providerID != KILO_PROVIDER && item.providerID !in providers.connected) return null
    if (item.modelID !in provider.models) return null
    return item
}

internal fun modelSelection(value: String): ModelSelectionDto? {
    val slash = value.indexOf('/')
    if (slash <= 0 || slash >= value.length - 1) return null
    return ModelSelectionDto(value.substring(0, slash), value.substring(slash + 1))
}
