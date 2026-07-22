import { describe, expect } from "bun:test"
import { DateTime, Effect } from "effect"
import { Credential } from "@opencode-ai/core/credential"
import { Integration } from "@opencode-ai/core/integration"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { SessionRunnerModel } from "@opencode-ai/core/session/runner/model"
import { it } from "../lib/effect"

describe("SessionRunnerModel Kilo credentials", () => {
  it.effect("maps OAuth account IDs to Kilo organization routing", () =>
    Effect.gen(function* () {
      const model = new ModelV2.Info({
        id: ModelV2.ID.make("test-model"),
        providerID: ProviderV2.ID.make("kilo"),
        name: "Test model",
        api: {
          id: ModelV2.ID.make("api-test-model"),
          type: "aisdk",
          package: "@ai-sdk/openai-compatible",
          url: "https://api.kilo.ai/openrouter",
        },
        capabilities: { tools: true, input: ["text"], output: ["text"] },
        request: { headers: {}, body: {}, generation: {}, options: {} },
        variants: [],
        time: { released: DateTime.makeUnsafe(0) },
        cost: [],
        status: "active",
        enabled: true,
        limit: { context: 100, output: 20 },
      })
      const credential = new Credential.Stored({
        id: Credential.ID.create(),
        integrationID: Integration.ID.make("kilo"),
        label: "Work",
        value: new Credential.OAuth({
          type: "oauth",
          methodID: Integration.MethodID.make("oauth"),
          refresh: "refresh",
          access: "access",
          expires: 1,
          metadata: { accountID: "org-enterprise" },
        }),
      })

      const resolved = yield* SessionRunnerModel.fromCatalogModel(
        model,
        { type: "credential", id: credential.id, label: credential.label },
        credential,
      )

      expect(resolved.route.defaults.http?.body).toMatchObject({ kilocodeOrganizationId: "org-enterprise" })
      expect(resolved.route.defaults.http?.body).not.toHaveProperty("accountID")
    }),
  )
})
