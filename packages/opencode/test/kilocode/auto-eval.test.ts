import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Process } from "@/util/process"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import type { Provider } from "@/provider/provider"
import {
  EVAL_ENTRYPOINT,
  evalCliArgs,
  evalCliVersion,
  evalDockerfile,
  evalDockerRunArgs,
  evalImageTag,
  evalProviderConfig,
  hostUrl,
  redactedConfig,
} from "@/kilocode/auto-routing/eval-docker"
import { parseKiloRunEvents } from "@/kilocode/auto-routing/eval-events"
import { fetchClientEvalCase } from "@kilocode/kilo-gateway"

const MODEL: Provider.Model = {
  id: ModelV2.ID.make("qwen3"),
  providerID: ProviderV2.ID.make("ollama"),
  api: { id: "qwen3:8b", url: "http://localhost:11434/v1", npm: "@ai-sdk/openai-compatible" },
  name: "qwen3",
  family: "qwen",
  capabilities: {
    temperature: true,
    reasoning: false,
    attachment: false,
    toolcall: true,
    input: { text: true, audio: false, image: true, video: false, pdf: false },
    output: { text: true, audio: false, image: false, video: false, pdf: false },
    interleaved: false,
  },
  cost: { input: 1, output: 2, cache: { read: 0, write: 0 } },
  limit: { context: 32_768, output: 4_096 },
  status: "active",
  options: {},
  headers: {},
  release_date: "2026-01-01",
  variants: { low: {}, high: {} },
}

const PROVIDER: Provider.Info = {
  id: ProviderV2.ID.make("ollama"),
  name: "Ollama",
  source: "config",
  env: [],
  options: {
    baseURL: "http://localhost:11434/v1",
    apiKey: "sk-secret-value",
    headers: { Authorization: "Bearer sk-secret-value" },
    kilocodeToken: "kilo-token-value",
  },
  models: { qwen3: MODEL },
}

describe("host URL rewriting", () => {
  test("sends loopback endpoints to the Docker host gateway", () => {
    expect(hostUrl("http://localhost:11434/v1")).toBe("http://host.docker.internal:11434/v1")
    expect(hostUrl("http://127.0.0.1:1234/v1/")).toBe("http://host.docker.internal:1234/v1/")
    expect(hostUrl("http://0.0.0.0:8080/v1")).toBe("http://host.docker.internal:8080/v1")
    expect(hostUrl("http://[::1]:11434/v1")).toBe("http://host.docker.internal:11434/v1")
  })

  test("keeps remote endpoints", () => {
    expect(hostUrl("https://api.example.com/v1")).toBe("https://api.example.com/v1")
  })
})

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
  })

  test("rejects a dist-tag or range passed as --cli-version", () => {
    for (const flag of ["latest", "^7.8.0", "7.8", "v7.8.12", "local"]) {
      const result = evalCliVersion({ flag, installed: "7.8.12" })
      expect(result.ok).toBe(false)
    }
  })
})

describe("image tag", () => {
  test("is stable for one version and changes with the entrypoint or version", () => {
    expect(evalImageTag("1.2.3")).toBe(evalImageTag("1.2.3"))
    expect(evalImageTag("1.2.3")).not.toBe(evalImageTag("1.2.4"))
    expect(evalImageTag("1.2.3")).toMatch(/^kilo-auto-eval:[0-9a-f]{12}$/)
  })
})

describe("eval provider config", () => {
  const config = () => evalProviderConfig({ model: MODEL, provider: PROVIDER })

  test("rewrites the loopback base URL for the container", () => {
    expect(config().provider.ollama.options.baseURL).toBe("http://host.docker.internal:11434/v1")
  })

  test("strips credentials from the config", () => {
    const options = config().provider.ollama.options
    expect(options.apiKey).toBeUndefined()
    expect(options.headers).toBeUndefined()
    expect(options.kilocodeToken).toBeUndefined()
    expect(JSON.stringify(config())).not.toContain("sk-secret-value")
  })

  test("declares the resolved model metadata and only that provider", () => {
    const entry = config().provider.ollama.models.qwen3
    expect(config().enabled_providers).toEqual(["ollama"])
    expect(entry.id).toBe("qwen3:8b")
    expect(entry.tool_call).toBe(true)
    expect(entry.reasoning).toBe(false)
    expect(entry.modalities.input).toEqual(["text", "image"])
    expect(entry.limit).toEqual({ context: 32_768, output: 4_096 })
    expect(entry.cost).toEqual({ input: 1, output: 2, cache_read: 0, cache_write: 0 })
    expect(Object.keys(entry.variants ?? {})).toEqual(["low", "high"])
  })

  test("keeps configured model headers and drops credential headers", () => {
    const model = { ...MODEL, headers: { "X-Route": "eu", Authorization: "Bearer sk-secret-value", "x-api-key": "k" } }
    const entry = evalProviderConfig({ model, provider: PROVIDER }).provider.ollama.models.qwen3
    expect(entry.headers).toEqual({ "X-Route": "eu" })
    expect(config().provider.ollama.models.qwen3.headers).toBeUndefined()
  })
})

describe("docker invocation", () => {
  test("runs one fresh container per case with stdin open and the host gateway alias", () => {
    const args = evalDockerRunArgs({
      image: "kilo-auto-eval:abc",
      envFile: "/tmp/eval.env",
      args: ["-m", "ollama/qwen3"],
    })
    expect(args).toEqual([
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
      const promptFile = path.join(dir, "prompt.txt")
      await fs.writeFile(promptFile, prompt)
      const input = await fs.open(promptFile, "r")
      try {
        const result = await Process.text(["node", path.join(dir, "entry.mjs"), "-m", "ollama/qwen3"], {
          env: { PATH: `${dir}${path.delimiter}${process.env.PATH ?? ""}` },
          stdin: input.fd,
        })
        const container = JSON.parse(result.text) as { exitCode: number; stdoutLines: string[] }
        const seen = JSON.parse(container.stdoutLines[0] ?? "{}") as { argv: string[]; stdin: string }
        expect(container.exitCode).toBe(0)
        expect(seen.argv).toEqual(["run", "--format", "json", "--auto", "-m", "ollama/qwen3"])
        expect(Buffer.from(seen.stdin, "base64").equals(Buffer.from(prompt))).toBe(true)
      } finally {
        await input.close()
      }
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
          { mode: 0o755 },
        )
        const result = await Process.text(["node", path.join(dir, "entry.mjs")], {
          env: { PATH: `${dir}${path.delimiter}${process.env.PATH ?? ""}` },
        })
        return JSON.parse(result.text) as { stdoutTruncated: boolean }
      }
      expect((await run(3 * 1024 * 1024)).stdoutTruncated).toBe(true)
      expect((await run(1024)).stdoutTruncated).toBe(false)
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  test("rejects a case response without the exact prompt", async () => {
    await expect(
      fetchClientEvalCase({
        routerId: "00000000-0000-4000-8000-000000000001",
        caseId: "case-1",
        fetch: async () =>
          Response.json({
            caseId: "case-1",
            baseRouter: "efficient",
            systemPrompt: "S",
            userPrompt: "U",
            timeoutMs: 1,
          }),
      }),
    ).rejects.toThrow("Unexpected response")
  })
})

describe("redacted config output", () => {
  test("replaces credential-shaped values", () => {
    const printed = redactedConfig({
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
