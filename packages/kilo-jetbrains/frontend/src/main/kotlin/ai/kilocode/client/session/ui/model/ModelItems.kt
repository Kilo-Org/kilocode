package ai.kilocode.client.session.ui.model

import ai.kilocode.rpc.dto.ProvidersDto

private const val KILO_PROVIDER = "kilo"

internal fun List<ModelPicker.Item>.findModel(key: String?): ModelPicker.Item? {
    if (key == null) return null
    // A bare Gateway ID can be identical to another provider's qualified key.
    return firstOrNull { it.key == key } ?: firstOrNull { it.id == key }
}

/**
 * Builds the model picker item list from workspace [providers], filtered to the Kilo provider and
 * any connected providers. Small models are dropped unless [includeSmall] is set. Shared by the
 * models settings page and the New Worktree dialog so the mapping stays in one place.
 */
internal fun modelItems(providers: ProvidersDto?, includeSmall: Boolean = false): List<ModelPicker.Item> {
    val cfg = providers ?: return emptyList()
    return cfg.providers
        .filter { it.id == KILO_PROVIDER || it.id in cfg.connected }
        .flatMap { provider ->
            provider.models.mapNotNull { (id, model) ->
                val item = ModelPicker.Item(
                    id = id,
                    display = model.name,
                    provider = provider.id,
                    providerName = provider.name,
                    inputPrice = model.inputPrice,
                    outputPrice = model.outputPrice,
                    contextLength = model.contextLength,
                    releaseDate = model.releaseDate,
                    latest = model.latest,
                    recommendedIndex = model.recommendedIndex,
                    free = model.free,
                    byok = model.byok,
                    variants = model.variants,
                    limit = model.limit,
                    cost = model.cost,
                    capabilities = model.capabilities,
                    options = model.options,
                    autoRouting = model.autoRouting,
                    terminalBench = model.terminalBench,
                    reasoning = model.reasoning,
                    attachment = model.attachment,
                    mayTrainOnYourPrompts = model.mayTrainOnYourPrompts,
                )
                if (!includeSmall && ModelText.small(item)) return@mapNotNull null
                item
            }
        }
}
