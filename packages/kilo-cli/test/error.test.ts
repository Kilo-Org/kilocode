import { expect, test } from "bun:test"
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
