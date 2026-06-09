import { afterEach, describe, expect, test } from "bun:test"
import { $ } from "bun"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ExportEvent } from "@/kilocode/session-export/events"
import { Capture } from "@/kilocode/session-export/capture"
import { createWorkspaceProvider } from "@/kilocode/session-export/workspace-provider"

describe("session export worker e2e", () => {
  const dirs: string[] = []

  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  test("captures git repository state from a leaf directory through capture", async () => {
    const dir = mkdtempSync(join(tmpdir(), "session-export-git-e2e-"))
    dirs.push(dir)
    mkdirSync(join(dir, "app", "src"), { recursive: true })
    writeFileSync(join(dir, "package.json"), '{"name":"repo"}\n')
    writeFileSync(join(dir, "app", "src", "index.ts"), "export const value = 1\n")
    await $`git init`.cwd(dir).quiet()

    const posted: unknown[] = []
    const cap = capture(posted, createWorkspaceProvider({ root: join(dir, "app", "src") }))

    cap.beforeRequest(request("git-session"))
    await until(() => Boolean(envelope(posted, "workspace_baseline_completed")))

    const env = envelope(posted, "workspace_baseline_completed")
    expect(env?.type).toBe("workspace_baseline_completed")
    if (env?.type !== "workspace_baseline_completed") return
    expect(env.capture?.mode).toBe("git-tracked-and-untracked")
    expect(env.files.map((file) => file.path)).toEqual(["app/src/index.ts", "package.json"])
  })

  test("does not capture non-git filesystem state through capture", async () => {
    const dir = mkdtempSync(join(tmpdir(), "session-export-nongit-e2e-"))
    dirs.push(dir)
    writeFileSync(join(dir, "loose.txt"), "do not sync me\n")

    const posted: unknown[] = []
    const cap = capture(posted, createWorkspaceProvider({ root: dir }))

    cap.beforeRequest(request("nongit-session"))
    await until(() => Boolean(envelope(posted, "workspace_baseline_completed")))

    const env = envelope(posted, "workspace_baseline_completed")
    expect(env?.type).toBe("workspace_baseline_completed")
    if (env?.type !== "workspace_baseline_completed") return
    expect(env.capture?.mode).toBe("none")
    expect(env.files).toEqual([])
  })
})

async function until(check: () => boolean): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < 1_000) {
    if (check()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error("timed out waiting for worker rows")
}

function capture(posted: unknown[], snap: ConstructorParameters<typeof Capture>[0]["snapshotProvider"]) {
  const seq = { value: 0 }
  return new Capture({
    worker: {
      postMessage: (msg) => posted.push(msg),
      terminate: () => {},
    },
    agentVersion: "v0",
    nowMs: () => 100,
    syncSeq: () => seq.value++,
    snapshotProvider: snap,
    baselineTimeoutMs: 1_000,
  })
}

function envelope(posted: unknown[], type: ExportEvent["type"]): ExportEvent | undefined {
  return posted
    .map((item) => (item as { envelope?: ExportEvent }).envelope)
    .find((item): item is ExportEvent => item?.type === type)
}

function request(sessionId: string): Parameters<Capture["beforeRequest"]>[0] {
  return {
    input: { model: { api: { npm: "@kilocode/kilo-gateway" }, isFree: true }, org: { type: "personal" } },
    requestMeta: {
      sessionId,
      rootSessionId: sessionId,
      requestId: `${sessionId}-request`,
      userMessageId: `${sessionId}-user`,
      agent: "build",
      modeId: "build",
    },
    assembled: {
      system: [],
      messages: [{ role: "user", content: "hello" }],
      tools: {},
      permissions: [],
      params: {},
    },
  }
}
