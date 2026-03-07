import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { generateCommitMessage } from "../../commit-message"
import { lazy } from "../../util/lazy"
import { errors } from "../error"

export const CommitMessageRoutes = lazy(() =>
  new Hono().post(
    "/",
    describeRoute({
      summary: "Generate commit message",
      description: "Generate a commit message using AI based on the current git diff.",
      operationId: "commitMessage.generate",
      responses: {
        200: {
          description: "Generated commit message",
          content: {
            "application/json": {
              schema: resolver(z.object({ message: z.string() })),
            },
          },
        },
        ...errors(400),
      },
    }),
    validator(
      "json",
      z.object({
        path: z.string().meta({ description: "Workspace/repo path" }),
        selectedFiles: z.array(z.string()).optional().meta({ description: "Optional subset of files to include" }),
        previousMessage: z
          .string()
          .optional()
          .meta({ description: "Previously generated message — triggers regeneration with a different result" }),
      }),
    ),
    async (c) => {
      const body = c.req.valid("json")
      const result = await generateCommitMessage(body)
      return c.json({ message: result.message })
    },
  ),
)
