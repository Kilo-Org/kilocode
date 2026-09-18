#!/usr/bin/env bun
import { fileURLToPath } from "url"

const dir = fileURLToPath(new URL("..", import.meta.url))
process.chdir(dir)

import { $ } from "bun"
import path from "path"

import { createClient } from "@hey-api/openapi-ts"

const opencode = path.resolve(dir, "../../opencode")

await $`bun dev generate > ${dir}/openapi.json`.cwd(opencode)

const document = (await Bun.file("./openapi.json").json()) as {
  components?: { schemas?: Record<string, unknown> }
  [key: string]: unknown
}
const schemas = document.components?.schemas
if (schemas) {
  const reachable = new Set<string>()
  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(visit)
      return
    }
    if (typeof value !== "object" || value === null) return
    for (const [key, child] of Object.entries(value)) {
      if (key === "$ref" && typeof child === "string" && child.startsWith("#/components/schemas/")) {
        const name = child.slice("#/components/schemas/".length)
        if (reachable.has(name)) continue
        reachable.add(name)
        visit(schemas[name])
      } else {
        visit(child)
      }
    }
  }
  visit({ ...document, components: { ...document.components, schemas: undefined } })
  for (const name of Object.keys(schemas)) {
    if (/^SessionNext\w+1$/.test(name) && !reachable.has(name)) delete schemas[name]
  }
  await Bun.write("./openapi.json", JSON.stringify(document))
}

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

const generatedTypes = await Bun.file("./src/v2/gen/types.gen.ts").text()
if (/export type SessionNext\w+1 =/.test(generatedTypes)) {
  throw new Error("Session history generated duplicate Session event variants")
}
const historyTypesPatched = generatedTypes.replace(
  /(export type V2SessionHistoryData = \{[\s\S]*?query\?: \{\s*limit\?: )string([;,]\s*after\?: )string/,
  "$1number$2number",
)
if (historyTypesPatched === generatedTypes) {
  throw new Error("Session history numeric query patch did not apply")
}
await Bun.write("./src/v2/gen/types.gen.ts", historyTypesPatched)

const generatedSdk = await Bun.file("./src/v2/gen/sdk.gen.ts").text()
const historySdkPatched = generatedSdk.replace(
  /(Get session history[\s\S]*?parameters: \{\s*sessionID: string[;,]\s*limit\?: )string([;,]\s*after\?: )string/,
  "$1number$2number",
)
if (historySdkPatched === generatedSdk) {
  throw new Error("Session history numeric SDK patch did not apply")
}
await Bun.write("./src/v2/gen/sdk.gen.ts", historySdkPatched)

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

await $`bun prettier --write src/gen src/v2`
await $`rm -rf dist tsconfig.tsbuildinfo`
await $`bun tsc`
await $`rm openapi.json`
