import { Effect } from "effect"
import { ModelV2 } from "../../model"
import { PluginV2 } from "../../plugin"
import { ProviderV2 } from "../../provider"
import { resolveBin } from "./cli"
import { createClaudeCode, MODELS } from "./provider"

const id = ProviderV2.ID.make("claude-code")

// Not a real npm package — `api.package` is only a dispatch key for the
// `aisdk.sdk` hook. Claiming it here keeps DynamicProviderPlugin (which would
// otherwise try to npm-install the name) from ever seeing it.
const PACKAGE = "@kilocode/claude-code"

export const ClaudeCodePlugin = PluginV2.define({
  id: PluginV2.ID.make("claude-code"),
  effect: Effect.gen(function* () {
    return {
      "catalog.transform": Effect.fn(function* (evt) {
        // Only surface the provider when the CLI is actually installed —
        // otherwise every user would see models they cannot run.
        const bin = resolveBin()
        if (!bin) {
          evt.provider.remove(id)
          return
        }
        evt.provider.update(id, (provider) => {
          provider.name = "Claude Code"
          provider.api = { type: "aisdk", package: PACKAGE }
          provider.disabled = false
          // Auth lives inside the CLI (subscription OAuth in the user's own
          // keychain), so there is no credential for Kilo to hold or refresh —
          // presence of the binary is what makes the provider usable. `bin`
          // rides along in request.body, which AISDK.prepareOptions spreads
          // into the factory options.
          provider.request.body.bin = bin
        })
        for (const item of MODELS) {
          evt.model.update(id, ModelV2.ID.make(item.id), (model) => {
            model.name = item.name
            // Leave `model.api` untouched so Catalog.resolve inherits the
            // provider's aisdk api with this model's id.
            //
            // Image input is real (verified live against the CLI, not a
            // placeholder — see the comment on MODELS in ./provider.ts).
            // ModelV2's Capabilities schema (packages/core/src/model.ts) has
            // no reasoning-effort/variants concept at all, unlike the v1
            // Provider.Model type — so unlike the v1 catalog
            // (packages/opencode/src/kilocode/claude-code/provider.ts), this
            // v2 registration cannot express the effort-tiering
            // ProviderTransform.variants() computes for v1. That's a
            // structural gap in v2, not an oversight here.
            model.capabilities = { tools: true, input: ["text", "image"], output: ["text"] }
            model.limit = { context: item.context, output: item.output }
            // Usage is billed against the Claude subscription, not per-token
            // API spend, so an empty cost table keeps Kilo from reporting a
            // charge the user will never see on an invoice.
            model.cost = []
            model.status = "active"
            model.enabled = true
          })
        }
      }),
      "aisdk.sdk": Effect.fn(function* (evt) {
        if (evt.package !== PACKAGE) return
        evt.sdk = createClaudeCode(evt.options)
      }),
    }
  }),
})
