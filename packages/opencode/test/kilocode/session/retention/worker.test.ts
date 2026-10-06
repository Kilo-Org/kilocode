import { expect, spyOn, test } from "bun:test"
import { KiloRetentionTui } from "@/kilocode/session/retention/tui"
import { KiloRetentionWorker } from "@/kilocode/session/retention/worker"

for (const cloudFork of [false, true]) {
  test(`TUI worker ${cloudFork ? "defers cloud import" : "starts normal cleanup"} at boot`, async () => {
    const previous = process.env[KiloRetentionTui.defer]
    const run = spyOn(KiloRetentionWorker, "start").mockResolvedValue(undefined)
    try {
      Object.assign(process.env, KiloRetentionTui.env({ cloudFork }))
      KiloRetentionWorker.boot()
      expect(run).toHaveBeenCalledTimes(cloudFork ? 0 : 1)
      if (cloudFork) {
        await KiloRetentionWorker.start({ session: "ses_imported" })
        expect(run).toHaveBeenCalledTimes(1)
      }
    } finally {
      run.mockRestore()
      if (previous == null) delete process.env[KiloRetentionTui.defer]
      else process.env[KiloRetentionTui.defer] = previous
    }
  })
}

test("a normal TUI launch overrides an inherited cloud-fork deferral", () => {
  const env = Object.assign({ [KiloRetentionTui.defer]: "1" }, KiloRetentionTui.env({}))
  expect(env[KiloRetentionTui.defer]).toBe("0")
})
