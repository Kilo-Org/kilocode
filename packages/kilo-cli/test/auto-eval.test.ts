import { describe, expect, test } from "bun:test"
import { KiloCustomRouter } from "@kilocode/gateway-core"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {
  EVAL_ENTRYPOINT,
  evalCliArgs,
  evalCliVersion,
  evalDockerfile,
  evalDockerRunArgs,
  evalImageTag,
} from "../src/auto/eval-docker"
import { parseKiloRunEvents } from "../src/auto/eval-events"
import { runItem } from "../src/auto/eval"
import { Effect } from "effect"

// Port of v1 packages/opencode/test/kilocode/auto-eval.test.ts (#15183). The container config assertions are in
// packages/kilo-plugin/test/gateway-routers.test.ts, where v2 builds the config.
describe("eval image", () => {
  test("builds the dockerfile from the platform base image with the host CLI version", () => {
    const dockerfile = evalDockerfile("1.2.3")
    expect(dockerfile).toContain("FROM node:22-slim")
    expect(dockerfile).toContain("ca-certificates git python3 g++ make")
    expect(dockerfile).toContain("npm install -g @kilocode/cli@1.2.3")
    expect(dockerfile).toContain("COPY eval-run.mjs ./")
  })

  test("caps output, mirrors the platform event flags, and honors the case timeout", () => {
    expect(EVAL_ENTRYPOINT).toContain("run', '--format', 'json', '--auto'")
    expect(EVAL_ENTRYPOINT).toContain("STDOUT_CAP_BYTES = 2 * 1024 * 1024")
    expect(EVAL_ENTRYPOINT).toContain("STDERR_CAP_BYTES = 4 * 1024")
    expect(EVAL_ENTRYPOINT).toContain("EVAL_TIMEOUT_MS")
  })

  test("tags are stable for one version and change with the entrypoint or version", () => {
    expect(evalImageTag("1.2.3")).toBe(evalImageTag("1.2.3"))
    expect(evalImageTag("1.2.3")).not.toBe(evalImageTag("1.2.4"))
    expect(evalImageTag("1.2.3")).toMatch(/^kilo-auto-eval:[0-9a-f]{12}$/)
  })
})

describe("eval CLI version", () => {
  test("uses the installed version when it is published", () => {
    expect(evalCliVersion({ installed: "7.8.12" })).toEqual({ ok: true, version: "7.8.12" })
    expect(evalCliVersion({ installed: "7.9.0-rc.1" })).toEqual({ ok: true, version: "7.9.0-rc.1" })
  })

  test("refuses source and branch builds instead of falling back to latest", () => {
    for (const installed of ["local", "0.0.0-feat-auto-custom-routers-202610161851", "latest", ""]) {
      const result = evalCliVersion({ installed })
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.message).toContain("--cli-version")
    }
  })

  test("lets an explicit published version override an unpublished build", () => {
    expect(evalCliVersion({ flag: "7.8.12", installed: "local" })).toEqual({ ok: true, version: "7.8.12" })
    expect(evalCliVersion({ flag: " ", installed: "7.8.12" })).toEqual({ ok: true, version: "7.8.12" })
    for (const flag of ["latest", "^7.8.0", "7.8", "v7.8.12", "local"])
      expect(evalCliVersion({ flag, installed: "7.8.12" }).ok).toBe(false)
  })
})

describe("docker invocation", () => {
  test("runs one fresh container per case with stdin open and the host gateway alias", () => {
    expect(
      evalDockerRunArgs({ image: "kilo-auto-eval:abc", envFile: "/tmp/eval.env", args: ["-m", "ollama/qwen3"] }),
    ).toEqual([
      "run",
      "--rm",
      "-i",
      "--add-host",
      "host.docker.internal:host-gateway",
      "--env-file",
      "/tmp/eval.env",
      "kilo-auto-eval:abc",
      "-m",
      "ollama/qwen3",
    ])
  })

  test("passes the variant only when the case names one, and never the prompt", () => {
    expect(evalCliArgs({ provider: "ollama", model: "qwen3", variant: "high" })).toEqual([
      "-m",
      "ollama/qwen3",
      "--variant",
      "high",
    ])
    expect(evalCliArgs({ provider: "ollama", model: "qwen3", variant: null })).toEqual(["-m", "ollama/qwen3"])
  })

  // The entrypoint runs inside a Linux container; a shebang stand-in for `kilo` needs a POSIX host.
  test.skipIf(process.platform === "win32").each([
    [
      "an ordinary prompt with spaces and quotes",
      'System line\n\nUser task with `code` and "quotes"\n\nIMPORTANT: answer only.',
    ],
    ["a long-context prompt over 128 KiB", 'workspace line with "quotes" and ünïcode\n'.repeat(4_000)],
  ])("gives the CLI %s byte for byte on stdin, outside argv", async (_kind, prompt) => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-auto-eval-entry-"))
    try {
      await fs.writeFile(path.join(dir, "entry.mjs"), EVAL_ENTRYPOINT)
      await fs.writeFile(
        path.join(dir, "kilo"),
        [
          "#!/usr/bin/env node",
          "const chunks = []",
          "process.stdin.on('data', (c) => chunks.push(c))",
          "process.stdin.on('end', () => console.log(JSON.stringify({ argv: process.argv.slice(2), stdin: Buffer.concat(chunks).toString('base64') })))",
        ].join("\n"),
        { mode: 0o755 },
      )
      await fs.writeFile(path.join(dir, "prompt.txt"), prompt)
      const container = await entry(dir, ["-m", "ollama/qwen3"], Bun.file(path.join(dir, "prompt.txt")))
      const seen = JSON.parse(container.stdoutLines[0] ?? "{}") as { argv: string[]; stdin: string }
      expect(container.exitCode).toBe(0)
      expect(seen.argv).toEqual(["run", "--format", "json", "--auto", "-m", "ollama/qwen3"])
      expect(Buffer.from(seen.stdin, "base64").equals(Buffer.from(prompt))).toBe(true)
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  test.skipIf(process.platform === "win32")("reports a truncated event stream when stdout passes the cap", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-auto-eval-entry-"))
    try {
      await fs.writeFile(path.join(dir, "entry.mjs"), EVAL_ENTRYPOINT)
      const run = async (size: number) => {
        await fs.writeFile(
          path.join(dir, "kilo"),
          `#!/usr/bin/env node\nprocess.stdout.write('x'.repeat(${size}) + '\\n')`,
          {
            mode: 0o755,
          },
        )
        return entry(dir, [])
      }
      expect((await run(3 * 1024 * 1024)).stdoutTruncated).toBe(true)
      expect((await run(1024)).stdoutTruncated).toBe(false)
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
})

describe("redacted config output", () => {
  test("replaces credential-shaped values", () => {
    const printed = KiloCustomRouter.redacted({
      provider: { ollama: { options: { apiKey: "sk-secret-value", baseURL: "http://localhost:1" } } },
      authorizationToken: "abc",
    })
    expect(printed).not.toContain("sk-secret-value")
    expect(printed).not.toContain("abc")
    expect(printed).toContain("http://localhost:1")
  })
})

describe("kilo run event parsing", () => {
  test("collects completed text parts and sums step-finish cost", () => {
    const lines = [
      JSON.stringify({ type: "text", part: { text: "part one", time: { end: 1 } } }),
      JSON.stringify({ type: "text", part: { text: "still streaming" } }),
      JSON.stringify({ type: "step_finish", part: { cost: 0.25 } }),
      JSON.stringify({ type: "step-finish", part: { cost: 0.5 } }),
      "not json",
    ]
    expect(parseKiloRunEvents(lines)).toEqual({ text: "part one", costUsd: 0.75 })
  })

  test("accepts the flattened shape and reports no cost when the model is free", () => {
    const lines = [JSON.stringify({ type: "text", text: "answer", time: { end: 1 } })]
    expect(parseKiloRunEvents(lines)).toEqual({ text: "answer", costUsd: null })
  })
})

// One case end to end with a stand-in `docker` on PATH and a stub server: the env file with credentials is removed
// on success and on every failure.
describe.skipIf(process.platform === "win32")("eval case run", () => {
  const router = { id: "3f2504e0-4f89-11d3-9a0c-0305e82c3301" } as Parameters<typeof runItem>[1]
  const plan = { engineIdentity: "engine-1" } as Parameters<typeof runItem>[2]
  const item = {
    entry: { kind: "client", provider: "local", model: "qwen3" },
    variant: null,
    caseId: "case-1",
    rep: 0,
  } as const
  const result = (lines: string[]) =>
    JSON.stringify({
      exitCode: 0,
      durationMs: 12,
      timedOut: false,
      stdoutTruncated: false,
      stdoutLines: lines,
      stderrTail: "",
    })

  async function run(input: { docker: string; upload?: () => Promise<unknown>; server?: string }) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-auto-eval-run-"))
    const tmp = path.join(root, "tmp")
    const bin = path.join(root, "bin")
    await fs.mkdir(tmp)
    await fs.mkdir(bin)
    // The stand-in copies the env file it receives, then prints the container result.
    await fs.writeFile(
      path.join(bin, "docker"),
      `#!/bin/sh\nwhile [ "$1" != "--env-file" ]; do shift; done\ncp "$2" "${root}/seen.env"\ncat <<'EOF'\n${input.docker}\nEOF\n`,
      { mode: 0o755 },
    )
    const uploads: unknown[] = []
    const connection = {
      options: { location: { directory: root } },
      rpc: {
        "routers.evalCase": async () => ({
          caseId: "case-1",
          baseRouter: "efficient",
          prompt: "Reply with OK.",
          timeoutMs: 5_000,
        }),
        "routers.evalConfig": async () => ({
          server: input.server ?? "https://api.kilo.ai",
          organizationID: "team",
          provider: "local",
          model: "qwen3",
          config: { enabled_providers: ["local"] },
          auth: { kilo: { type: "api", key: "kilo-fixture-key" } },
        }),
        "routers.evalResult": async (args: { result: unknown }) => {
          uploads.push(args.result)
          return input.upload ? input.upload() : { score: 1 }
        },
      },
    } as unknown as Parameters<typeof runItem>[0]
    const previous = { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR }
    process.env.PATH = `${bin}${path.delimiter}${previous.PATH ?? ""}`
    process.env.TMPDIR = tmp
    try {
      const outcome = await Effect.runPromise(
        Effect.result(runItem(connection, router, plan, item, new Map(), "kilo-auto-eval:test")),
      )
      const left = await fs.readdir(tmp)
      const seen = await Bun.file(path.join(root, "seen.env"))
        .text()
        .catch(() => "")
      return { outcome, left, seen, uploads }
    } finally {
      process.env.PATH = previous.PATH
      if (previous.TMPDIR === undefined) delete process.env.TMPDIR
      else process.env.TMPDIR = previous.TMPDIR
      await fs.rm(root, { recursive: true, force: true })
    }
  }

  test("uploads the graded output and removes the credential env file", async () => {
    const text = JSON.stringify({ type: "text", part: { text: "OK", time: { end: 1 } } })
    const done = await run({ docker: result([text]) })
    expect(done.outcome._tag).toBe("Success")
    expect(done.uploads).toEqual([
      {
        routerId: router.id,
        engineIdentity: "engine-1",
        entry: item.entry,
        variant: null,
        caseId: "case-1",
        rep: 0,
        output: "OK",
        costUsd: 0,
        durationMs: 12,
        exitCode: 0,
        timedOut: false,
      },
    ])
    expect(done.seen).toContain('KILO_AUTH_CONTENT={"kilo":{"type":"api","key":"kilo-fixture-key"}}')
    expect(done.seen).toContain("KILO_ORG_ID=team")
    expect(done.left).toEqual([])
  })

  test("removes the env file when the container gives no result", async () => {
    const failed = await run({ docker: "not json" })
    expect(failed.outcome._tag).toBe("Failure")
    expect(String(failed.outcome._tag === "Failure" ? failed.outcome.failure.message : "")).toContain(
      "Container produced no result",
    )
    expect(failed.uploads).toEqual([])
    expect(failed.left).toEqual([])
  })

  test("removes the env file when the upload fails and keeps the error code", async () => {
    const failed = await run({
      docker: result([]),
      upload: () => Promise.reject({ type: "router", message: "limit", data: { code: "quota_exceeded" } }),
    })
    expect(failed.outcome._tag === "Failure" ? failed.outcome.failure : undefined).toMatchObject({
      code: "quota_exceeded",
    })
    expect(failed.left).toEqual([])
  })

  test("refuses a value with a line break instead of writing extra variables", async () => {
    const failed = await run({ docker: result([]), server: "https://api.kilo.ai\nINJECTED=1" })
    expect(failed.outcome._tag === "Failure" ? failed.outcome.failure.message : "").toContain(
      "KILO_API_URL contains a line break",
    )
    expect(failed.seen).toBe("")
    expect(failed.left).toEqual([])
  })
})

async function entry(dir: string, args: string[], stdin?: Bun.BunFile) {
  const proc = Bun.spawn(["node", path.join(dir, "entry.mjs"), ...args], {
    env: { PATH: `${dir}${path.delimiter}${process.env.PATH ?? ""}` },
    stdin: stdin ?? "ignore",
    stdout: "pipe",
  })
  const text = await new Response(proc.stdout).text()
  await proc.exited
  return JSON.parse(text) as { exitCode: number; stdoutLines: string[]; stdoutTruncated: boolean }
}
