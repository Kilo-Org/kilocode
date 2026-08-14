import { Effect } from "effect"
import { AgentV2 } from "@opencode-ai/core/agent"
import { isRecord } from "../../server/httpapi-exercise/assertions"
import { request } from "../../server/httpapi-exercise/backend"
import { pollWithTimeout } from "../../lib/effect"
import type { ScenarioContext } from "../../server/httpapi-exercise/types"

export function sessionAfterDefaultAgent(ctx: ScenarioContext, title: string) {
  return Effect.gen(function* () {
    const session = yield* ctx.session({ title })
    // GET /api/agent and POST /permission share this directory today; a workspace/worktree
    // session would boot a different AgentV2 and this wait would not cover it.
    yield* pollWithTimeout(
      request("GET", { path: "/api/agent", headers: ctx.headers() }).pipe(
        Effect.map((result) => {
          const body = result.body
          if (!isRecord(body) || !Array.isArray(body.data)) return undefined
          return body.data.some((item) => isRecord(item) && item.id === AgentV2.defaultID) ? (true as const) : undefined
        }),
      ),
      "default agent never loaded before permission create",
    )
    return session
  }).pipe(Effect.orDie)
}
