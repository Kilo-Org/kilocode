import { mergeDeep } from "remeda"
import type { Config } from "@/config/config"
import { Provider } from "@/provider/provider"
import { ProviderTransform } from "@/provider/transform"

export namespace KiloSmallModel {
  function selected(model: Provider.Model, cfg: Pick<Config.Info, "small_model_variant_overrides">) {
    const key = `${model.providerID}/${model.id}`
    const name = cfg.small_model_variant_overrides?.[key] ?? undefined
    if (!name) return
    const options = model.variants?.[name]
    if (!options) return
    return { name, options }
  }

  export function variant(model: Provider.Model, cfg: Pick<Config.Info, "small_model_variant_overrides">) {
    return selected(model, cfg)?.options ?? {}
  }

  export function base(
    model: Provider.Model,
    cfg: Pick<Config.Info, "small_model_variant_overrides">,
  ): Record<string, any> {
    const value = selected(model, cfg)
    if (!value) return ProviderTransform.smallOptions(model) ?? {}
    return (
      ProviderTransform.smallOptions({
        ...model,
        variants: { [value.name]: value.options },
      }) ?? {}
    )
  }

  export function options(
    model: Provider.Model,
    cfg: Pick<Config.Info, "small_model_variant_overrides">,
    ...sources: Array<Record<string, any> | undefined>
  ): Record<string, any> {
    return [...sources, variant(model, cfg)].reduce<Record<string, any>>(
      (result, source) => mergeDeep(result, source ?? {}) as Record<string, any>,
      base(model, cfg),
    )
  }
}
