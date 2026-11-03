package ai.kilocode.client.agentManager.hosted

import ai.kilocode.client.app.KiloAppService
import ai.kilocode.rpc.dto.HostedAgentDto
import ai.kilocode.rpc.dto.ProvidersDto

internal data class HostedAgentSelection(
    val agent: String,
    val model: String,
    val variant: String? = null,
) {
    fun dto(): HostedAgentDto = HostedAgentDto(agent, model, variant)
}

/**
 * The saved variant is only valid while the model still offers it. A stale value from an older
 * model listing would otherwise be sent with a model that no longer supports it.
 */
internal fun savedVariant(saved: String?, model: String, providers: ProvidersDto?): String? {
    if (saved == null) return null
    val parts = model.split("/", limit = 2)
    if (parts.size != 2) return null
    val variants = providers?.providers
        ?.firstOrNull { it.id == parts[0] }
        ?.models?.get(parts[1])
        ?.variants
        .orEmpty()
    return saved.takeIf { it in variants }
}

/** The app-wide agent, model, and reasoning variant used for a new Cloud workspace or session. */
internal fun hostedSelection(app: KiloAppService, providers: ProvidersDto? = null): HostedAgentSelection? {
    val config = app.state.value.config
    val agent = config?.defaultAgent?.takeIf { it.isNotBlank() } ?: "code"
    val model = app.models.value.model[agent]?.let { "${it.providerID}/${it.modelID}" }
        ?: app.models.value.recent.firstOrNull()?.let { "${it.providerID}/${it.modelID}" }
        ?: config?.model?.takeIf { it.isNotBlank() }
        ?: return null
    val variant = savedVariant(app.models.value.variant[model], model, providers)
    return HostedAgentSelection(agent, model, variant)
}
