import { expect, test } from "bun:test"

// The generated SDK is the wire contract clients read. Assert the scheduled
// session status variant survives regeneration: a session asleep on a pending
// wakeup must be distinguishable from an idle one, and the wake time travels in
// the same payload as `scheduledAt`.
const source = await Bun.file(`${import.meta.dir}/../src/v2/gen/types.gen.ts`).text()

test("generated SessionStatus includes the scheduled variant", () => {
  expect(source).toMatch(/type: "scheduled"\s*\n\s*scheduledAt: string/)
})
