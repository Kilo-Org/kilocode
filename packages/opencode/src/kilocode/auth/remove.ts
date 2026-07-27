import { Auth } from "@/auth"
import { IntegrationSchema } from "@opencode-ai/core/integration/schema"
import { Credential } from "@opencode-ai/core/credential"
import { Effect } from "effect"

export const remove = Effect.fn("KiloAuth.remove")(function* (key: string) {
  const auth = yield* Auth.Service
  const credentials = yield* Credential.Service
  const integration = IntegrationSchema.ID.make(key.replace(/\/+$/, ""))
  const existing = yield* credentials.list(integration)
  yield* Effect.forEach(existing, (credential) => credentials.remove(credential.id), {
    concurrency: 1,
    discard: true,
  })
  yield* auth.remove(key).pipe(Effect.orDie)
})
