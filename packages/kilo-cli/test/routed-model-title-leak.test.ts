import { expect, test } from "bun:test"
import path from "node:path"
import { fixture } from "./fixture"

// Positive no-account-data regression over every wire body the launched host sends.
//
// Two request families once bypassed the session http.request hook seam, so the
// Gateway's post-serialization credential sanitizer never saw them:
//  1. Title generation — Review1's source audit corrected the earlier claim that
//     Core packages/core/src/session/title.ts drives LLMClient directly: it runs
//     through SessionContext.prepare, which is SessionModelRequest.prepare, so the
//     StreamOptions.http middleware applies the hook there too.
//  2. The compatible Auto alias (@ai-sdk/openai-compatible/kilo) — it stayed on the
//     AISDK adapter for its routedModelID metadata extractor, and AISDK-adapter
//     transports (packages/core/src/aisdk.ts modelFromLanguage) do not apply the
//     hook middleware. The alias is retired: compatible Auto models now resolve to
//     the Kilo-owned native packages/ai/src/kilocode/openai-compatible-routed.ts
//     route, which isolates credential metadata at the provider-package boundary
//     and transports through the same hook middleware as every other native route.
// The fixture imports a hostile device-OAuth-shaped key credential and asserts no
// request body — title, Auto, compatible Auto, or ordinary — carries reserved
// account fields. This test must fail normally when the host cannot start or the
// fixture marker is missing; only a clean all-wire run passes.
test("title and compatible-Auto requests keep credential metadata out of request bodies", async () => {
  await using input = await fixture()
  const child = Bun.spawn(
    [
      path.resolve(import.meta.dir, "../dist/interactive/bun"),
      "--no-env-file",
      path.join(import.meta.dir, "routed-model-integration-fixture.ts"),
    ],
    {
      cwd: input.cwd,
      env: input.env,
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
      timeout: 30000,
      killSignal: "SIGKILL",
    },
  )
  try {
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])
    expect(code, `${stdout}\n${stderr}`).toBe(0)
    expect(stdout).toContain("ROUTED_MODEL_INTEGRATION_OK")
  } finally {
    child.kill()
    await child.exited
  }
}, 45000)
