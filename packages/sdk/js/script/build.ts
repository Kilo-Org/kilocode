#!/usr/bin/env bun
import { fileURLToPath } from "url"

const dir = fileURLToPath(new URL("..", import.meta.url))
process.chdir(dir)

import { $ } from "bun"
import path from "path"

import { createClient } from "@hey-api/openapi-ts"

const opencode = path.resolve(dir, "../../opencode")

await $`bun dev generate > ${dir}/openapi.json`.cwd(opencode)

await createClient({
  input: "./openapi.json",
  output: {
    path: "./src/v2/gen",
    tsConfigPath: path.join(dir, "tsconfig.json"),
    clean: true,
  },
  plugins: [
    {
      name: "@hey-api/typescript",
      exportFromIndex: false,
    },
    {
      name: "@hey-api/sdk",
      instance: "KiloClient",
      exportFromIndex: false,
      auth: false,
      paramsStructure: "flat",
    },
    {
      name: "@hey-api/client-fetch",
      exportFromIndex: false,
      baseUrl: "http://localhost:4096",
    },
  ],
})

// Patch a @hey-api/openapi-ts codegen bug: SseFn incorrectly passes the
// endpoint's TError into the second generic of ServerSentEventsResult, which
// is the AsyncGenerator's TReturn slot. Iterator return values have nothing
// to do with HTTP errors, and any consumer that calls `.return()` or returns
// from a mock generator gets type-checked against the wrong shape. Drop the
// arg so TReturn defaults to void.
const sseTypesPath = "./src/v2/gen/client/types.gen.ts"
const sseTypesFile = Bun.file(sseTypesPath)
const sseTypesSource = await sseTypesFile.text()
const sseTypesPatched = sseTypesSource.replace(
  "=> Promise<ServerSentEventsResult<TData, TError>>",
  "=> Promise<ServerSentEventsResult<TData>>",
)
if (sseTypesPatched === sseTypesSource) {
  throw new Error(`SseFn patch did not apply; @hey-api/openapi-ts output may have changed (${sseTypesPath})`)
}
await Bun.write(sseTypesPath, sseTypesPatched)

// The legacy SDK generator is retired, but this public Config type remains exported.
// Keep Kilo's released sandbox settings aligned with the current generated client.
const legacyTypesPath = "./src/gen/types.gen.ts"
const legacyTypesFile = Bun.file(legacyTypesPath)
const legacySource = await legacyTypesFile.text()
const sandbox = `  /**
   * Sandbox configuration for agent tools
   */
  sandbox?: {
    /**
     * Enable sandbox confinement for new sessions (default: false)
     */
    enabled?: boolean
    /**
     * Control outbound network access from sandboxed tools (default: deny)
     */
    network?: "allow" | "deny"
    /**
     * Additional filesystem paths that sandboxed tools may write to
     */
    writable_paths?: Array<string>
  }
`
const legacyPatched = legacySource.includes(sandbox)
  ? legacySource
  : legacySource.replace("  experimental?: {\n", sandbox + "  experimental?: {\n")
if (!legacyPatched.includes(sandbox)) {
  throw new Error(`Legacy Config sandbox patch did not apply (${legacyTypesPath})`)
}
await Bun.write(legacyTypesPath, legacyPatched)

await $`bun prettier --write src/gen`
await $`bun prettier --write src/v2`
await $`rm -rf dist tsconfig.tsbuildinfo`
await $`bun tsc`
await $`rm openapi.json`
