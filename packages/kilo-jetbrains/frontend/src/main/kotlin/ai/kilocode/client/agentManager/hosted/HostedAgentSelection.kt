package ai.kilocode.client.agentManager.hosted

import ai.kilocode.client.app.KiloAppService
import ai.kilocode.rpc.dto.HostedAgentDto

internal data class HostedAgentSelection(
    val agent: String,
    val model: String,
    val variant: String? = null,
) {
    fun dto(): HostedAgentDto = HostedAgentDto(agent, model, variant)
}

/** The app-wide agent, model, and reasoning variant used for a new Cloud workspace or session. */
internal fun hostedSelection(app: KiloAppService): HostedAgentSelection? {
    val config = app.state.value.config
    val agent = config?.defaultAgent?.takeIf { it.isNotBlank() } ?: "code"
    val model = app.models.value.model[agent]?.let { "${it.providerID}/${it.modelID}" }
        ?: app.models.value.recent.firstOrNull()?.let { "${it.providerID}/${it.modelID}" }
        ?: config?.model?.takeIf { it.isNotBlank() }
        ?: return null
    return HostedAgentSelection(agent, model, app.models.value.variant[model])
}
