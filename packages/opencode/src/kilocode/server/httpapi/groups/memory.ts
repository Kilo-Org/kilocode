import { Schema } from "effect"
import { MemoryContract } from "@kilocode/kilo-memory/effect/httpapi"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "@/server/routes/instance/httpapi/middleware/authorization"
import { InstanceContextMiddleware } from "@/server/routes/instance/httpapi/middleware/instance-context"
import {
  WorkspaceRoutingMiddleware,
  WorkspaceRoutingQueryFields,
} from "@/server/routes/instance/httpapi/middleware/workspace-routing"
import { described } from "@/server/routes/instance/httpapi/groups/metadata"
import { MemoryApiClientError, MemoryApiServerError } from "@kilocode/kilo-memory/effect/errors"

const MemoryErrors = [MemoryApiClientError, MemoryApiServerError] as const

export const MemoryQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
})

export const MemoryRememberPayload = MemoryContract.RememberPayload
export const MemoryCorrectPayload = MemoryContract.CorrectPayload
export const MemoryForgetPayload = MemoryContract.ForgetPayload
export const MemoryConfigurePayload = MemoryContract.ConfigurePayload
export const MemoryPurgePayload = MemoryContract.PurgePayload
export const MemoryPaths = MemoryContract.Paths

export const MemoryApi = HttpApi.make("memory")
  .add(
    HttpApiGroup.make("memory")
      .add(
        HttpApiEndpoint.get("status", MemoryPaths.status, {
          query: MemoryQuery,
          success: described(MemoryContract.Status, "Memory status"),
          error: MemoryErrors,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "memory.status",
            summary: "Get memory status",
            description: "Return memory state, index preview, and token estimate for the active workspace.",
          }),
        ),
        HttpApiEndpoint.get("show", MemoryPaths.show, {
          query: MemoryQuery,
          success: described(MemoryContract.Show, "Memory source and index"),
          error: MemoryErrors,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "memory.show",
            summary: "Show memory",
            description:
              "Return source memory files, generated index, recent decision summary, and memory save decisions.",
          }),
        ),
        HttpApiEndpoint.post("enable", MemoryPaths.enable, {
          query: MemoryQuery,
          success: described(MemoryContract.Enable, "Memory enabled"),
          error: MemoryErrors,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "memory.enable",
            summary: "Enable memory",
            description: "Scaffold and enable project memory for the active workspace.",
          }),
        ),
        HttpApiEndpoint.post("disable", MemoryPaths.disable, {
          query: MemoryQuery,
          success: described(MemoryContract.Disable, "Memory disabled"),
          error: MemoryErrors,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "memory.disable",
            summary: "Disable memory",
            description: "Disable project memory without deleting local memory files.",
          }),
        ),
        HttpApiEndpoint.post("configure", MemoryPaths.configure, {
          query: MemoryQuery,
          payload: MemoryConfigurePayload,
          success: described(MemoryContract.Disable, "Memory configured"),
          error: MemoryErrors,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "memory.configure",
            summary: "Configure memory",
            description: "Update project memory settings such as automatic project fact capture.",
          }),
        ),
        HttpApiEndpoint.post("rebuild", MemoryPaths.rebuild, {
          query: MemoryQuery,
          success: described(MemoryContract.Enable, "Memory rebuilt"),
          error: MemoryErrors,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "memory.rebuild",
            summary: "Rebuild memory index",
            description: "Regenerate index.kmem from source memory files.",
          }),
        ),
        HttpApiEndpoint.post("remember", MemoryPaths.remember, {
          query: MemoryQuery,
          payload: MemoryRememberPayload,
          success: described(MemoryContract.Operation, "Memory operation result"),
          error: MemoryErrors,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "memory.remember",
            summary: "Remember text",
            description: "Persist explicit user-provided memory text through the deterministic operation pipeline.",
          }),
        ),
        HttpApiEndpoint.post("correct", MemoryPaths.correct, {
          query: MemoryQuery,
          payload: MemoryCorrectPayload,
          success: described(MemoryContract.Operation, "Memory correction result"),
          error: MemoryErrors,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "memory.correct",
            summary: "Remember correction",
            description: "Persist explicit corrective memory under corrections.md.",
          }),
        ),
        HttpApiEndpoint.post("forget", MemoryPaths.forget, {
          query: MemoryQuery,
          payload: MemoryForgetPayload,
          success: described(MemoryContract.Operation, "Memory forget result"),
          error: MemoryErrors,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "memory.forget",
            summary: "Forget memory",
            description: "Remove memory lines by exact key, id, or normalized key text and rebuild the index.",
          }),
        ),
        HttpApiEndpoint.post("purge", MemoryPaths.purge, {
          query: MemoryQuery,
          payload: MemoryPurgePayload,
          success: described(MemoryContract.Purge, "Memory purged"),
          error: MemoryErrors,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "memory.purge",
            summary: "Purge memory",
            description: "Delete all project memory files for the active workspace.",
          }),
        ),
      )
      .annotateMerge(
        OpenApi.annotations({
          title: "memory",
          description: "Kilo memory routes.",
        }),
      )
      .middleware(InstanceContextMiddleware)
      .middleware(WorkspaceRoutingMiddleware)
      .middleware(Authorization),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "kilo HttpApi",
      version: "0.0.1",
      description: "Kilo HttpApi surface.",
    }),
  )
