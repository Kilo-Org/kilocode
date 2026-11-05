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
 */

import { resolve } from "node:path"

const args = Bun.argv.slice(2)
const cloud = resolve(args.shift() ?? process.env.KILO_E2E_CLOUD_REPO ?? "../cloud")
let request: string | undefined
let result: string | undefined

for (let i = 0; i < args.length; i++) {
  const arg = args[i]
  if (arg === "--request") request = args[++i]
  else if (arg === "--result") result = args[++i]
  else throw new Error(`unknown argument: ${arg}`)
}

if (!request || !result) throw new Error("--request and --result are required")

const document = await Bun.file(request).json()
const operation = document.operation
if (operation !== "prepare" && operation !== "cleanup") {
  throw new Error(`unsupported provider operation: ${operation}`)
}

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
  { cwd: cloud, env: process.env, stdout: "inherit", stderr: "inherit" },
)

process.exit(await proc.exited)
