import type { Config } from "@/config/config"

/**
 * Field-scoped effective value for `require_approval_for_config_edits`.
 *
 * The shared config loader merges the legacy home config directories (`~/.kilocode`, `~/.kilo`) after
 * the project sources, so with the generic merge an explicit project value can lose to a legacy global
 * value. Reordering the generic loader would change every config key, so this tracker remembers the
 * last explicit boolean value seen from an eligible source — a project-local source, or the explicit
 * `KILO_CONFIG_DIR` files — in loader encounter order, and re-applies it once after the directory pass
 * (before `KILO_CONFIG_CONTENT`, cloud, and managed config, which keep their normal precedence). Legacy
 * home files that are not the explicit env dir are ignored, so they only win when no eligible source
 * set the field and the value falls through to the normal global merge. Only this one key is touched.
 */
export namespace KiloLocalOverride {
  export const field = "require_approval_for_config_edits" as const

  export function make() {
    let eligible: boolean | undefined
    return {
      /**
       * Record an eligible explicit value. `scope` is the loader's classification; project-local
       * sources pass `"local"`, and the loader also observes the explicit `KILO_CONFIG_DIR` files as
       * `"local"` even though that directory is merged with the global trust policy.
       */
      observe(info: Config.Info, scope: "global" | "local") {
        if (scope !== "local") return
        const value = info[field]
        if (typeof value === "boolean") eligible = value
      },
      /** Re-apply the last eligible value. Idempotent; `undefined` leaves the normal merge untouched. */
      apply(info: Config.Info): Config.Info {
        if (eligible === undefined || info[field] === eligible) return info
        return { ...info, [field]: eligible }
      },
    }
  }
}
