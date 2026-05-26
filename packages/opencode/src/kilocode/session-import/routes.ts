import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import { lazy } from "../../util/lazy"
import { errors } from "../../server/error"
import { SessionImportService } from "./service"
import { SessionImportType } from "./types"
import { Project } from "../../project/project"
import { runRequest } from "../../server/routes/instance/trace"

export const SessionImportRoutes = lazy(() =>
  new Hono()
    .post(
      "/project",
      describeRoute({
        summary: "Insert project for session import",
        description: "Insert or update a project row used by legacy session import.",
        operationId: "kilocode.sessionImport.project",
        responses: {
          200: {
            description: "Project import result",
            content: {
              "application/json": {
                schema: resolver(SessionImportType.Result),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", SessionImportType.Project),
      async (c) => {
        const input = c.req.valid("json")
        // Do not resolve an empty legacy worktree, because that would fall back to the current
        // process directory and silently attach the migrated session to the wrong project.
        if (!input.worktree.trim()) throw new Error("Legacy project import requires a non-empty worktree")
        const result = await runRequest(
          "SessionImportRoutes.project",
          c,
          Project.Service.use((svc) => svc.fromDirectory(input.worktree)),
        )
        return c.json({ ok: true, id: result.project.id })
      },
    )
    .post(
      "/session",
      describeRoute({
        summary: "Insert session for session import",
        description: "Insert or update a session row used by legacy session import.",
        operationId: "kilocode.sessionImport.session",
        responses: {
          200: {
            description: "Session import result",
            content: {
              "application/json": {
                schema: resolver(SessionImportType.Result),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", SessionImportType.Session),
      async (c) => c.json(await SessionImportService.session(c.req.valid("json"))),
    )
    .post(
      "/message",
      describeRoute({
        summary: "Insert message for session import",
        description: "Insert or update a message row used by legacy session import.",
        operationId: "kilocode.sessionImport.message",
        responses: {
          200: {
            description: "Message import result",
            content: {
              "application/json": {
                schema: resolver(SessionImportType.Result),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", SessionImportType.Message),
      async (c) => c.json(await SessionImportService.message(c.req.valid("json"))),
    )
    .post(
      "/part",
      describeRoute({
        summary: "Insert part for session import",
        description: "Insert or update a part row used by legacy session import.",
        operationId: "kilocode.sessionImport.part",
        responses: {
          200: {
            description: "Part import result",
            content: {
              "application/json": {
                schema: resolver(SessionImportType.Result),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", SessionImportType.Part),
      async (c) => c.json(await SessionImportService.part(c.req.valid("json"))),
    ),
)
