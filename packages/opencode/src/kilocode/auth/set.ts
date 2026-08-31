import { Auth } from "@/auth"
import { Integration } from "@opencode-ai/core/integration"
import { Credential } from "@opencode-ai/core/credential"
import { Effect } from "effect"

export const set = Effect.fn("KiloAuth.set")(function* (key: string, info: Auth.Info) {
  if (info.type === "wellknown") {
    const auth = yield* Auth.Service
    yield* auth.set(key, info).pipe(Effect.orDie)
    return
  }
  const credentials = yield* Credential.Service
  const integration = Integration.ID.make(key.replace(/\/+$/, ""))
  const value = Credential.legacyValue(integration, info)
  const current = (yield* credentials.list(integration)).at(-1)
  if (current) {
    yield* credentials.update(current.id, { value })
    return
  }
  yield* credentials.create({ integrationID: integration, value })
})
