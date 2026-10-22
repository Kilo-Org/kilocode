import { expect, test } from "bun:test"
import { KiloMarketplaceRpc } from "@opencode/schema/kilocode/marketplace"
import { Cause, Effect } from "effect"
import { formatError, UserError } from "../src/error"
import { call } from "../src/marketplace/handlers/client"

test("expected user errors print only their message, including through Effect traces", async () => {
  const run = Effect.fn("cli.marketplace.uninstall")(function* () {
    return yield* Effect.fail(new UserError({ message: "Skill is not installed; rerun with --project." }))
  })
  const output = await Effect.runPromise(run().pipe(Effect.catchCause((cause) => Effect.succeed(formatError(cause)))))
  expect(output).toBe("Error: Skill is not installed; rerun with --project.")
})

test("marketplace calls preserve expected errors for concise reporting", async () => {
  const output = await Effect.runPromise(
    call(() => Promise.reject(new UserError({ message: "Restart the background server." }))).pipe(
      Effect.catchCause((cause) => Effect.succeed(formatError(cause))),
    ),
  )
  expect(output).toBe("Error: Restart the background server.")
})

test("unexpected failures and defects retain their diagnostic stack traces", () => {
  const error = new Error("Unexpected failure")
  const defect = new UserError({ message: "Unexpected defect" })
  expect(formatError(Cause.fail(error))).toBe(Cause.pretty(Cause.fail(error)))
  expect(formatError(Cause.fail(error))).toContain("error.test.ts:")
  expect(formatError(Cause.die(defect))).toBe(Cause.pretty(Cause.die(defect)))
  expect(formatError(Cause.die(defect))).toContain("error.test.ts:")
})

test.each(Object.keys(KiloMarketplaceRpc.Definition.methods.list.errors))(
  "declared marketplace RPC errors retain actionable messages: %s",
  async (type) => {
    const output = await Effect.runPromise(
      call(() => Promise.reject({ type, message: "Fix the config and retry." })).pipe(
        Effect.catchCause((cause) => Effect.succeed(formatError(cause))),
      ),
    )
    expect(output).toBe("Error: Fix the config and retry.")
  },
)

test("unexpected RPC failures retain their message and diagnostics", async () => {
  const error = { type: "rpc.internal", message: "Unexpected server failure" }
  const output = await Effect.runPromise(
    call(() => Promise.reject(error)).pipe(Effect.catchCause((cause) => Effect.succeed(formatError(cause)))),
  )
  expect(output).toContain(error.message)
  expect(output).toContain("[cause]")
  expect(output).not.toBe(`Error: ${error.message}`)
  expect(await Effect.runPromise(call(() => Promise.reject(error)).pipe(Effect.flip))).toMatchObject({
    message: error.message,
    cause: error,
  })
})
