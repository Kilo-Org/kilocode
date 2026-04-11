import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import { lazy } from "../../util/lazy"
import { errors } from "../../server/error"
import { SessionImportService } from "./service"
import { SessionImportType } from "./types"

// In-memory idempotency key storage (per-process, cleared on restart)
const processedKeys = new Set<string>()

/**
 * Check if an idempotency key has been processed.
 * Returns true if the key was already processed (duplicate request).
 */
function checkIdempotency(key: string | null | undefined): { isDuplicate: boolean; key: string | null } {
  if (!key) return { isDuplicate: false, key: null }
  if (processedKeys.has(key)) return { isDuplicate: true, key }
  processedKeys.add(key)
  // Prevent unbounded growth - limit to 10000 keys
  if (processedKeys.size > 10000) {
    const firstKey = processedKeys.values().next().value
    if (firstKey) processedKeys.delete(firstKey)
  }
  return { isDuplicate: false, key }
}

export const SessionImportRoutes = lazy(() =>
  new Hono()
    .post(
      "/project",
      describeRoute({
        summary: "Insert project for session import",
        description:
          "Insert or update a project row used by legacy session import. Supports idempotency via Idempotency-Key header.",
        operationId: "devilcode.sessionImport.project",
        responses: {
          200: {
            description: "Project import result",
            content: {
              "application/json": {
                schema: resolver(SessionImportType.Result),
              },
            },
          },
          409: {
            description: "Duplicate request - idempotency key already processed",
          },
          ...errors(400),
        },
      }),
      validator("json", SessionImportType.Project),
      async (c) => {
        const idempotencyKey = c.req.header("Idempotency-Key")
        const { isDuplicate } = checkIdempotency(idempotencyKey)
        if (isDuplicate) {
          c.status(409)
          return c.json({ success: true, data: { id: "duplicate" }, errors: [] })
        }
        return c.json(await SessionImportService.project(c.req.valid("json")))
      },
    )
    .post(
      "/session",
      describeRoute({
        summary: "Insert session for session import",
        description:
          "Insert or update a session row used by legacy session import. Supports idempotency via Idempotency-Key header.",
        operationId: "devilcode.sessionImport.session",
        responses: {
          200: {
            description: "Session import result",
            content: {
              "application/json": {
                schema: resolver(SessionImportType.Result),
              },
            },
          },
          409: {
            description: "Duplicate request - idempotency key already processed",
          },
          ...errors(400),
        },
      }),
      validator("json", SessionImportType.Session),
      async (c) => {
        const idempotencyKey = c.req.header("Idempotency-Key")
        const { isDuplicate } = checkIdempotency(idempotencyKey)
        if (isDuplicate) {
          c.status(409)
          return c.json({ success: true, data: { id: "duplicate" }, errors: [] })
        }
        return c.json(await SessionImportService.session(c.req.valid("json")))
      },
    )
    .post(
      "/message",
      describeRoute({
        summary: "Insert message for session import",
        description:
          "Insert or update a message row used by legacy session import. Supports idempotency via Idempotency-Key header.",
        operationId: "devilcode.sessionImport.message",
        responses: {
          200: {
            description: "Message import result",
            content: {
              "application/json": {
                schema: resolver(SessionImportType.Result),
              },
            },
          },
          409: {
            description: "Duplicate request - idempotency key already processed",
          },
          ...errors(400),
        },
      }),
      validator("json", SessionImportType.Message),
      async (c) => {
        const idempotencyKey = c.req.header("Idempotency-Key")
        const { isDuplicate } = checkIdempotency(idempotencyKey)
        if (isDuplicate) {
          c.status(409)
          return c.json({ success: true, data: { id: "duplicate" }, errors: [] })
        }
        return c.json(await SessionImportService.message(c.req.valid("json")))
      },
    )
    .post(
      "/part",
      describeRoute({
        summary: "Insert part for session import",
        description:
          "Insert or update a part row used by legacy session import. Supports idempotency via Idempotency-Key header.",
        operationId: "devilcode.sessionImport.part",
        responses: {
          200: {
            description: "Part import result",
            content: {
              "application/json": {
                schema: resolver(SessionImportType.Result),
              },
            },
          },
          409: {
            description: "Duplicate request - idempotency key already processed",
          },
          ...errors(400),
        },
      }),
      validator("json", SessionImportType.Part),
      async (c) => {
        const idempotencyKey = c.req.header("Idempotency-Key")
        const { isDuplicate } = checkIdempotency(idempotencyKey)
        if (isDuplicate) {
          c.status(409)
          return c.json({ success: true, data: { id: "duplicate" }, errors: [] })
        }
        return c.json(await SessionImportService.part(c.req.valid("json")))
      },
    ),
)
