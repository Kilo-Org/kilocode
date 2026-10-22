import { expect, test } from "bun:test"
import { Effect } from "effect"
import { Auth } from "@/auth"

test("legacy auth runtime layer remains buildable", async () => {
  const result = await Effect.runPromise(
    Auth.Service.use(() => Effect.succeed("ready")).pipe(Effect.provide(Auth.defaultLayer)),
  )

  expect(result).toBe("ready")
})
