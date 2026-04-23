import { errors } from "../../server/error"
import { NotFoundError } from "../../storage/db"
import { lazy } from "../../util/lazy"
import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { Suggestion } from "./index"

export const SuggestionRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "List pending suggestions",
        description: "Get all pending suggestion requests across all sessions.",
        operationId: "suggestion.list",
        responses: {
          200: {
            description: "List of pending suggestions",
            content: {
              "application/json": {
                schema: resolver(Suggestion.Request.array()),
              },
            },
          },
        },
      }),
      async (c) => {
        const suggestions = await Suggestion.list()
        return c.json(suggestions)
      },
    )
    .post(
      "/:requestID/accept",
      describeRoute({
        summary: "Accept suggestion request",
        description: "Accept a suggestion request from the AI assistant.",
        operationId: "suggestion.accept",
        responses: {
          200: {
            description: "Suggestion accepted successfully",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          requestID: z.string(),
        }),
      ),
      validator("json", Suggestion.Accept),
      async (c) => {
        const params = c.req.valid("param")
        const json = c.req.valid("json")
        const ok = await Suggestion.accept({
          requestID: params.requestID,
          index: json.index,
        })
        if (!ok) throw new NotFoundError({ message: `Suggestion not found: ${params.requestID}` })
        return c.json(true)
      },
    )
    .post(
      "/:requestID/dismiss",
      describeRoute({
        summary: "Dismiss suggestion request",
        description: "Dismiss a suggestion request from the AI assistant.",
        operationId: "suggestion.dismiss",
        responses: {
          200: {
            description: "Suggestion dismissed successfully",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          requestID: z.string(),
        }),
      ),
      async (c) => {
        const params = c.req.valid("param")
        const ok = await Suggestion.dismiss(params.requestID)
        if (!ok) throw new NotFoundError({ message: `Suggestion not found: ${params.requestID}` })
        return c.json(true)
      },
    ),
)
