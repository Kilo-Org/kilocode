import { createHash } from "node:crypto"
import { applyConfig, planConfig } from "./config"
import { planExtra } from "./extra-state"
import { explicitConfig, type preflight } from "./preflight"

/** Journal the intended output set, not the initial list of sources. A restart can
 * see both a newly created target and its original input following partial installation. */
export function resources(plan: ReturnType<typeof preflight>) {
  const config = planConfig(plan.legacyConfig, plan.previewConfig, explicitConfig(plan), plan.legacyDefaultConfig)
  const { home, stateBase, configBase, legacyConfig, previewConfig } = plan
  const extra = planExtra({ home, stateBase, configBase, legacyConfig, previewConfig })
  const conflicts = [...config.conflicts, ...extra.conflicts]
  if (conflicts.length) throw new Error(`Resolve configuration conflicts before migration: ${conflicts.join("; ")}`)
  const outputs = new Map<string, string>()
  for (const file of [...config.files, ...extra.files]) {
    const value = JSON.stringify([file.target, file.digest, "executable" in file && file.executable])
    const key = file.target.normalize("NFC").toLowerCase()
    if (outputs.has(key) && outputs.get(key) !== value) throw new Error(`Conflicting migration targets: ${file.target}`)
    outputs.set(key, value)
  }
  const digest = createHash("sha256")
    .update(JSON.stringify([config.explicit, [...outputs.values()].sort()]))
    .digest("hex")
  return {
    digest,
    skipped: config.skipped,
    apply() {
      applyConfig(config)
      extra.apply()
    },
  }
}
