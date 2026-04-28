import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { Config } from "../../config/config"
import { Provider } from "../../provider/provider"
import { mapValues } from "remeda"
import { errors, createNotFoundResponse, createErrorResponse } from "../error" // devilcode_change
import { Log } from "../../util/log"
import { lazy } from "../../util/lazy"
// devilcode_change start
import { fetchDefaultModel } from "@devilcode/kilo-gateway"
import { Auth } from "../../auth"
import { CanonicalTeamConfig } from "../../devilcode/team/config"
import { loadQuickstartTemplates, QUICKSTART_IDS } from "../../devilcode/team/quickstarts"
import { createLayeredTeamRepository } from "../../devilcode/team/layered-repository"
import { createFileSystemTeamRepository, TeamNotFoundError } from "../../devilcode/team/repository"
import { createQuickstartTeamRepository } from "../../devilcode/team/repositories/quickstart"
import type { TeamHandle } from "../../devilcode/team/repository"
import { Instance } from "../../project/instance"
// NOTE: server OpenAPI spec drifts from SDK types until Phase 9. SDK is NOT regenerated this phase.
// devilcode_change end

const log = Log.create({ service: "server" })

export const ConfigRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "Get configuration",
        description: "Retrieve the current OpenCode configuration settings and preferences.",
        operationId: "config.get",
        responses: {
          200: {
            description: "Get config info",
            content: {
              "application/json": {
                schema: resolver(Config.Info),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json(await Config.get())
      },
    )
    .patch(
      "/",
      describeRoute({
        summary: "Update configuration",
        description: "Update OpenCode configuration settings and preferences.",
        operationId: "config.update",
        responses: {
          200: {
            description: "Successfully updated config",
            content: {
              "application/json": {
                schema: resolver(Config.Info),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", Config.Info),
      async (c) => {
        const config = c.req.valid("json")
        await Config.update(config)
        return c.json(config)
      },
    )
    .post(
      "/team/validate",
      describeRoute({
        summary: "Validate team config",
        description: "Validate a team configuration payload without persisting it.",
        operationId: "config.team.validate",
        responses: {
          200: {
            description: "Validation status",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    valid: z.boolean(),
                    errors: z.array(z.string()),
                  }),
                ),
              },
            },
          },
        },
      }),
      validator("json", z.unknown()),
      async (c) => {
        const payload = c.req.valid("json")
        const result = CanonicalTeamConfig.safeParse(payload) // devilcode_change
        return c.json({
          valid: result.success,
          errors: result.success ? [] : result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
        })
      },
    )
    .get(
      "/team/presets",
      describeRoute({
        summary: "List team presets",
        description: "Return built-in team presets for Team Composer.",
        operationId: "config.team.presets",
        responses: {
          200: {
            description: "Team quickstart templates", // devilcode_change
            content: {
              "application/json": {
                schema: resolver(z.array(z.unknown())), // devilcode_change
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json(Object.values(loadQuickstartTemplates())) // devilcode_change
      },
    )
    // devilcode_change start — Phase 9: Team CRUD endpoints
    .get(
      "/team",
      describeRoute({
        summary: "List all teams",
        description: "Return all team handles from user storage and quickstart layer.",
        operationId: "config.team.list",
        responses: {
          200: {
            description: "Array of team handles",
            content: {
              "application/json": {
                schema: resolver(
                  z.array(
                    z.object({
                      id: z.string(),
                      name: z.string(),
                      path: z.string(),
                      updatedAt: z.string(),
                    }),
                  ),
                ),
              },
            },
          },
        },
      }),
      async (c) => {
        const repo = createLayeredTeamRepository({
          layers: [
            { name: "user", repository: createFileSystemTeamRepository(), writable: true },
            { name: "quickstart", repository: createQuickstartTeamRepository(), writable: false },
          ],
        })
        const handles: TeamHandle[] = await repo.listTeams()
        return c.json(handles)
      },
    )
    .get(
      "/team/:id",
      describeRoute({
        summary: "Load team by ID",
        description: "Return the canonical team config for the given team ID.",
        operationId: "config.team.get",
        responses: {
          200: {
            description: "Team configuration",
            content: {
              "application/json": {
                schema: resolver(z.unknown()),
              },
            },
          },
          ...errors(404),
        },
      }),
      async (c) => {
        const id = c.req.param("id")
        const repo = createLayeredTeamRepository({
          layers: [
            { name: "user", repository: createFileSystemTeamRepository(), writable: true },
            { name: "quickstart", repository: createQuickstartTeamRepository(), writable: false },
          ],
        })
        try {
          const config = await repo.loadTeam(id)
          return c.json(config)
        } catch (err) {
          if (err instanceof TeamNotFoundError) { // devilcode_change
            return c.json(createNotFoundResponse("team", id), 404)
          }
          throw err
        }
      },
    )
    .put(
      "/team/:id",
      describeRoute({
        summary: "Save or update team config",
        description: "Validate and persist a team configuration to user storage.",
        operationId: "config.team.save",
        responses: {
          200: {
            description: "Saved team handle",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    id: z.string(),
                    name: z.string(),
                    path: z.string(),
                    updatedAt: z.string(),
                  }),
                ),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", z.unknown()),
      async (c) => {
        const id = c.req.param("id")
        const payload = c.req.valid("json")
        const result = CanonicalTeamConfig.safeParse(payload)
        if (!result.success) {
          const issues = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
          return c.json(createErrorResponse(issues, "VALIDATION_ERROR"), 400)
        }
        const repo = createFileSystemTeamRepository()
        const handle = await repo.saveTeam(id, result.data)
        return c.json(handle)
      },
    )
    .delete(
      "/team/:id",
      describeRoute({
        summary: "Delete user team",
        description: "Remove a user team by ID. Quickstart teams cannot be deleted.",
        operationId: "config.team.delete",
        responses: {
          200: {
            description: "Deletion confirmation",
            content: {
              "application/json": {
                schema: resolver(z.object({ deleted: z.boolean() })),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      async (c) => {
        const id = c.req.param("id")
        // Reject deletion of quickstart IDs
        if ((QUICKSTART_IDS as readonly string[]).includes(id)) {
          return c.json(createErrorResponse(`Cannot delete built-in quickstart team "${id}"`, "QUICKSTART_READONLY"), 400)
        }
        const repo = createFileSystemTeamRepository()
        try {
          await repo.deleteTeam(id)
          return c.json({ deleted: true })
        } catch (err) {
          if (err instanceof TeamNotFoundError) { // devilcode_change
            return c.json(createNotFoundResponse("team", id), 404)
          }
          throw err
        }
      },
    )
    // devilcode_change end
    // devilcode_change start
    .get(
      "/warnings",
      describeRoute({
        summary: "Get config warnings",
        description: "Get warnings generated during config loading (e.g., invalid JSON, schema errors).",
        operationId: "config.warnings",
        responses: {
          200: {
            description: "Config warnings",
            content: {
              "application/json": {
                schema: resolver(Config.Warning.array()),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json(await Config.warnings())
      },
    )
    // devilcode_change end
    .get(
      "/providers",
      describeRoute({
        summary: "List config providers",
        description: "Get a list of all configured AI providers and their default models.",
        operationId: "config.providers",
        responses: {
          200: {
            description: "List of providers",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    providers: Provider.Info.array(),
                    default: z.record(z.string(), z.string()),
                  }),
                ),
              },
            },
          },
        },
      }),
      async (c) => {
        using _ = log.time("providers")
        const providers = await Provider.list()

        // devilcode_change start - Fetch default model from Devil API
        // Only call the Devil API when the kilo provider is actually available.
        // This prevents unnecessary network calls for teams using only their
        // own providers (e.g. LiteLLM) via enabled_providers config.
        let kiloApiDefault: string | undefined
        if (providers["kilo"]) {
          const kiloAuth = await Auth.get("kilo")
          const token = kiloAuth?.type === "oauth" ? kiloAuth.access : kiloAuth?.key
          const organizationId = kiloAuth?.type === "oauth" ? kiloAuth.accountId : undefined
          kiloApiDefault = await fetchDefaultModel(token, organizationId)
        }
        // devilcode_change end

        // devilcode_change start - Use API default for Devil provider if valid
        const defaults = mapValues(providers, (item) => Provider.sort(Object.values(item.models))[0].id)
        if (kiloApiDefault && providers["kilo"]?.models[kiloApiDefault]) {
          defaults["kilo"] = kiloApiDefault
        }
        // devilcode_change end

        return c.json({
          providers: Object.values(providers),
          default: defaults,
        })
      },
    ),
)
