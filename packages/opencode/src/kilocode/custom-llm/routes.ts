import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { lazy } from "../../util/lazy"
import { errors } from "../../server/error"
import { CustomLlm } from "./index"

export const CustomLlmRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "List custom LLMs",
        description: "Get all custom LLM definitions.",
        operationId: "kilocode.customLlm.list",
        responses: {
          200: {
            description: "List of custom LLMs",
            content: {
              "application/json": {
                schema: resolver(CustomLlm.Info.array()),
              },
            },
          },
        },
      }),
      async (c) => c.json(CustomLlm.list()),
    )
    .get(
      "/:id",
      describeRoute({
        summary: "Get custom LLM",
        description: "Get a single custom LLM by ID.",
        operationId: "kilocode.customLlm.get",
        responses: {
          200: {
            description: "Custom LLM",
            content: {
              "application/json": {
                schema: resolver(CustomLlm.Info),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ id: z.string() })),
      async (c) => {
        const row = CustomLlm.get(c.req.valid("param").id)
        if (!row) return c.json({ error: "Not found" }, 404)
        return c.json(row)
      },
    )
    .post(
      "/",
      describeRoute({
        summary: "Create custom LLM",
        description: "Create a new custom LLM definition.",
        operationId: "kilocode.customLlm.create",
        responses: {
          200: {
            description: "Created custom LLM",
            content: {
              "application/json": {
                schema: resolver(CustomLlm.Info),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", CustomLlm.Create),
      async (c) => c.json(CustomLlm.create(c.req.valid("json"))),
    )
    .put(
      "/:id",
      describeRoute({
        summary: "Update custom LLM",
        description: "Update an existing custom LLM definition.",
        operationId: "kilocode.customLlm.update",
        responses: {
          200: {
            description: "Updated custom LLM",
            content: {
              "application/json": {
                schema: resolver(CustomLlm.Info),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator("param", z.object({ id: z.string() })),
      validator("json", CustomLlm.Create),
      async (c) => {
        const { id } = c.req.valid("param")
        const body = c.req.valid("json")
        const row = CustomLlm.update({ id, ...body })
        if (!row) return c.json({ error: "Not found" }, 404)
        return c.json(row)
      },
    )
    .delete(
      "/:id",
      describeRoute({
        summary: "Delete custom LLM",
        description: "Delete a custom LLM definition.",
        operationId: "kilocode.customLlm.delete",
        responses: {
          200: {
            description: "Deleted",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ id: z.string() })),
      async (c) => {
        const ok = CustomLlm.remove(c.req.valid("param").id)
        if (!ok) return c.json({ error: "Not found" }, 404)
        return c.json(true)
      },
    ),
)
