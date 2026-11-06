#!/usr/bin/env bun

/**
 * Adapt the K1 provider subprocess contract to the Cloud fixture provider.
 *
 * K1 invokes the configured command as `<command> --request <file> --result <file>`
 * for both prepare and cleanup. The Cloud provider expects the operation as its
 * first positional argument, so read it from the request document and dispatch.
 *
 * Usage (used by script/e2e-session-open.ts):
 *   bun script/e2e-cloud-provider.ts <cloud-repo> --request <file> --result <file>
 *
 * The child output is mirrored to `provider-<operation>.log` next to the result so a
 * failed prepare/cleanup stays diagnosable even though K1 captures the driver streams.
 */

import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"

const LOG_LIMIT = 200_000

const args = Bun.argv.slice(2)
let request: string | undefined
let result: string | undefined
let positional: string | undefined

for (let i = 0; i < args.length; i++) {
  const arg = args[i]
  if (arg === "--request") request = args[++i]
  else if (arg === "--result") result = args[++i]
  else if (arg.startsWith("--")) throw new Error(`unknown argument: ${arg}`)
  else if (positional === undefined) positional = arg
  else throw new Error(`unknown argument: ${arg}`)
}

const cloud = resolve(positional ?? process.env.KILO_E2E_CLOUD_REPO ?? "../cloud")

if (!request || !result) throw new Error("--request and --result are required")

const document = await Bun.file(request).json()
const operation = document.operation
if (operation !== "prepare" && operation !== "cleanup") {
  throw new Error(`unsupported provider operation: ${operation}`)
}

const logPath = join(dirname(result), `provider-${operation}.log`)
const proc = Bun.spawn(
  [
    "pnpm",
    "--filter",
    "cloud-agent-next",
    "exec",
    "tsx",
    "test/e2e/fixture-provider.ts",
    operation,
    "--request",
    request,
    "--result",
    result,
  ],
  { cwd: cloud, env: process.env, stdout: "pipe", stderr: "pipe" },
)

let output = ""
async function pump(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    const text = decoder.decode(value, { stream: true })
    output = (output + text).slice(-LOG_LIMIT)
    process.stderr.write(text)
  }
}

const pumps = [pump(proc.stdout), pump(proc.stderr)]
const code = await proc.exited
await Promise.allSettled(pumps)
mkdirSync(dirname(logPath), { recursive: true })
writeFileSync(logPath, output, { mode: 0o600 })
process.exit(code)
