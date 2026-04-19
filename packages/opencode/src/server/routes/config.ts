import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { Config } from "../../config/config"
import { Provider } from "../../provider/provider"
import { mapValues } from "remeda"
import { errors } from "../error"
import { Log } from "../../util/log"
import { lazy } from "../../util/lazy"
// devilcode_change start
import { fetchDefaultModel } from "@devilcode/kilo-gateway"
import { Auth } from "../../auth"
import { CanonicalTeamConfig } from "../../devilcode/team/config"
import { loadQuickstartTemplates } from "../../devilcode/team/quickstarts"
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
        const result = CanonicalTeamConfig.safeParse(payload)
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
            description: "Team quickstart templates",
            content: {
              "application/json": {
                schema: resolver(z.array(z.unknown())),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json(Object.values(loadQuickstartTemplates()))
      },
    )
    // kilocode_change start
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
    // kilocode_change end
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
