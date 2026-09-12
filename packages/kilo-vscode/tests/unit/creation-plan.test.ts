import { expect, it } from "bun:test"
import { plan } from "../../src/agent-manager/creation-plan"
import { prepareDirectory } from "../../src/agent-manager/mcp-warmup"
import { prepareSession, runLifecycleSetup } from "../../src/agent-manager/provider-lifecycle"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { SetupScriptService } from "../../src/agent-manager/SetupScriptService"

it("defers provisioning when a real setup script appears after the initial plan", async () => {
  const root = await mkdtemp(join(tmpdir(), "creation-script-"))
  const dir = join(root, "worktree")
  const service = new SetupScriptService(root)
  const start = plan({ setupScript: service.hasScript() })
  expect(start).toBe("immediate")
  const entered = Promise.withResolvers<void>()
  const gate = Promise.withResolvers<void>()
  const flow: string[] = []
  try {
    await mkdir(dir)
    await service.createDefaultScript()
    const input = {
      service,
      destination: "vscode",
      log: () => {},
      post: () => {},
      vscode: async () => {
        flow.push("setup:start")
        entered.resolve()
        await gate.promise
        await writeFile(join(dir, ".env"), "PLUGIN=installed\n")
        flow.push("setup:end")
        return 0
      },
    } as Parameters<typeof runLifecycleSetup>[0]
    const pending = prepareSession(
      start,
      (early) => runLifecycleSetup(input, { repoPath: root, worktreePath: dir }, () => {}, early),
      async () => {
        flow.push("boot")
        expect(await readFile(join(dir, ".env"), "utf8")).toBe("PLUGIN=installed\n")
        return null
      },
    )
    await entered.promise
    expect(flow).toEqual(["setup:start"])
    gate.resolve()
    await (
      await pending
    ).done
    expect(flow).toEqual(["setup:start", "setup:end", "boot"])
  } finally {
    gate.resolve()
    await rm(root, { recursive: true, force: true })
  }
})

it("starts immediately only when no setup script exists", () => {
  expect(plan({ setupScript: false })).toBe("immediate")
  expect(plan({ setupScript: true })).toBe("afterSetup")
})

it("copies real .env files before the early session step", async () => {
  const root = await mkdtemp(join(tmpdir(), "creation-plan-"))
  const dir = join(root, "worktree")
  try {
    await mkdir(dir)
    await writeFile(join(root, ".env"), "VALUE=ready\n")
    const input = { service: undefined } as Parameters<typeof runLifecycleSetup>[0]
    await runLifecycleSetup(
      input,
      { repoPath: root, worktreePath: dir },
      () => {},
      async () => {
        expect(await readFile(join(dir, ".env"), "utf8")).toBe("VALUE=ready\n")
      },
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

it("rejects setup and session failures instead of leaving readiness pending", async () => {
  const fail = async () => {
    throw new Error("creation failed")
  }
  await expect(prepareSession("afterSetup", fail, async () => null)).rejects.toThrow("creation failed")
  await expect(prepareSession("immediate", async (early) => early?.(), fail)).rejects.toThrow("creation failed")
})

it("prepares directory endpoints in parallel and rejects failures", async () => {
  const calls: string[] = []
  const gate = Promise.withResolvers<never>()
  const snapshot = Promise.withResolvers<{ data: boolean }>()
  const settled = { value: false }
  const client = {
    config: {
      get: ({ directory }: { directory: string }) => {
        calls.push(`config:${directory}`)
        return gate.promise
      },
    },
    mcp: {
      status: async ({ directory }: { directory: string }) => {
        calls.push(`mcp:${directory}`)
        return { data: {} }
      },
    },
    kilocode: {
      snapshot: {
        prepare: ({ directory }: { directory: string }) => {
          calls.push(`snapshot:${directory}`)
          return snapshot.promise
        },
      },
    },
  } as unknown as Parameters<typeof prepareDirectory>[0]
  const pending = prepareDirectory(client, "/slot")
  const result = pending.then(
    () => {
      settled.value = true
    },
    (err: unknown) => {
      settled.value = true
      return err
    },
  )
  expect(calls).toEqual(["config:/slot", "mcp:/slot", "snapshot:/slot"])
  gate.reject(new Error("boot failed"))
  await new Promise<void>((resolve) => setImmediate(resolve))
  expect(settled.value).toBe(false)
  snapshot.resolve({ data: true })
  expect(await result).toEqual(new Error("boot failed"))
})
