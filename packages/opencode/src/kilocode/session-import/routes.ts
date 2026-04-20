import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import { lazy } from "../../util/lazy"
import { errors } from "../../server/error"
import { SessionImportService } from "./service"
import { SessionImportType } from "./types"

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
      async (c) => c.json(await SessionImportService.project(c.req.valid("json"))),
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
