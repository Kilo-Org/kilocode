// devilcode_change - new file
// Devil-specific routes that live in the CLI package (direct access to internals).
// All future kilo-specific endpoints should be added here.
import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { Skill } from "../../skill/skill"
import { Agent } from "../../agent/agent"
import { lazy } from "../../util/lazy"
import { errors } from "../error"
import { SessionImportRoutes } from "../../devilcode/session-import/routes"
import { WorkflowRoutes } from "../../devilcode/workflow/routes"

/**
 * Devil Code specific API routes.
 *
 * These endpoints provide direct access to Devil Code internals and are not part
 * of the standard OpenCode API. They support advanced features like custom skill
 * management, agent configuration, session import, and workflow orchestration.
 *
 * @openapi
 * tags:
 *   - name: Devil Code
 *     description: Devil-specific endpoints for advanced features
 */
export const DevilcodeRoutes = lazy(() =>
  new Hono()
    .route("/session-import", SessionImportRoutes())
    .route("/workflow", WorkflowRoutes())
    .post(
      "/skill/remove",
      describeRoute({
        summary: "Remove a skill",
        description:
          "Remove a skill by deleting its directory from disk and clearing it from cache. This operation is permanent and cannot be undone.",
        operationId: "devilcode.removeSkill",
        tags: ["Devil Code"],
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  location: {
                    type: "string",
                    description: "Absolute path to the skill directory to remove",
                    example: "/home/user/.config/kilo/skills/my-skill",
                  },
                },
                required: ["location"],
              },
            },
          },
        },
        responses: {
          200: {
            description: "Skill removed successfully",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          400: {
            description: "Invalid request - skill not found or cannot be removed",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    success: { type: "boolean" },
                    errors: { type: "array", items: { type: "object" } },
                  },
                },
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "json",
        z.object({
          location: z.string().min(1).max(500).describe("Absolute path to the skill directory"),
        }),
      ),
      async (c) => {
        const { location } = c.req.valid("json")
        await Skill.remove(location)
        return c.json(true)
      },
    )
    .post(
      "/agent/remove",
      describeRoute({
        summary: "Remove a custom agent",
        description:
          "Remove a custom (non-native) agent by deleting its markdown file from disk and refreshing state. Native agents cannot be removed. This operation is permanent.",
        operationId: "devilcode.removeAgent",
        tags: ["Devil Code"],
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  name: {
                    type: "string",
                    description: "Name of the custom agent to remove",
                    example: "my-custom-agent",
                  },
                },
                required: ["name"],
              },
            },
          },
        },
        responses: {
          200: {
            description: "Agent removed successfully",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          400: {
            description: "Invalid request - agent not found or is native and cannot be removed",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    success: { type: "boolean" },
                    errors: { type: "array", items: { type: "object" } },
                  },
                },
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "json",
        z.object({
          name: z.string().min(1).max(100).describe("Name of the custom agent"),
        }),
      ),
      async (c) => {
        const { name } = c.req.valid("json")
        await Agent.remove(name)
        return c.json(true)
      },
    ),
)
