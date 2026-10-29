import type { Config } from "@kilocode/sdk/v2"

/** Keep the custom endpoint and its credentials in the same global configuration scope. */
export function withGlobalImages<T extends Pick<Config, "experimental">>(
  cfg: T,
  global?: Pick<Config, "experimental">,
) {
  const host = global?.experimental
  return {
    ...cfg,
    experimental: {
      ...cfg.experimental,
      image_generation_base_url: host?.image_generation_base_url,
      image_generation_api_key: host?.image_generation_api_key,
      image_generation_options: host?.image_generation_options,
      ...(host?.image_generation_base_url?.trim() ? { image_generation_model: host.image_generation_model } : {}),
    },
  }
}
