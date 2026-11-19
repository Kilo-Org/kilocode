import { ClientApi } from "@opencode/protocol/client"
import { OpenApi } from "effect/http-api"
import path from "node:path"

// Use the same assembled API as @opencode/client. Endpoint paths and operation IDs can be changed
// by group-level transformations and are not necessarily the literals in a protocol source file.
const document = OpenApi.fromApi(ClientApi)
const operations = Object.entries(document.paths).flatMap(([route, spec]) =>
  Object.entries(spec).flatMap(([method, operation]) =>
    typeof operation === "object" &&
    operation &&
    "operationId" in operation &&
    typeof operation.operationId === "string"
      ? [{ id: operation.operationId, method: method.toUpperCase(), route }]
      : [],
  ),
)
if (new Set(operations.map((op) => op.id)).size !== operations.length) throw new Error("Duplicate operation ID")
const lines = operations
  .sort((a, b) => a.id.localeCompare(b.id, "en"))
  .map(({ id, route, method }) => `    "${id}" to V2Operation("${method}", "${route}"),`)
const output = process.argv[2] ?? path.join(import.meta.dir, "../backend/build/generated/v2/kotlin")
await Bun.write(
  path.join(output, "ai/kilocode/backend/v2/V2Operations.kt"),
  [
    "// Generated from @opencode/protocol/client by script/generate.ts. Do not edit.",
    "package ai.kilocode.backend.v2",
    "",
    "internal data class V2Operation(val method: String, val route: String)",
    "",
    "internal val v2Operations = mapOf(",
    ...lines,
    ")",
    "",
  ].join("\n"),
)
console.log(`Generated ${lines.length} v2 operations`)
