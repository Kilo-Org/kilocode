import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { Config } from "@/config"
import { Provider } from "@/provider"
import { errors } from "../../error"
import { lazy } from "@/util/lazy"
import { jsonRequest } from "./trace"
// kilocode_change start
import { fetchDefaultModel } from "@kilocode/kilo-gateway"
import { Auth } from "@/auth"
import { Effect } from "effect"
import { ModelID, ProviderID } from "@/provider/schema"
// kilocode_change end

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
      async (c) =>
        jsonRequest("ConfigRoutes.get", c, function* () {
          const cfg = yield* Config.Service
          return yield* cfg.get()
        }),
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
      async (c) =>
        jsonRequest("ConfigRoutes.update", c, function* () {
          const config = c.req.valid("json")
          const cfg = yield* Config.Service
          yield* cfg.update(config)
          return config
        }),
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
                schema: resolver(Provider.ConfigProvidersResult.zod),
              },
            },
          },
        },
      }),
      async (c) =>
        jsonRequest("ConfigRoutes.providers", c, function* () {
          const svc = yield* Provider.Service
          const providers = yield* svc.list()
          const defaults = Provider.defaultModelIDs(providers)

          // kilocode_change start - Fetch default model from Kilo API when the kilo provider is available.
          // Only call the Kilo API when the kilo provider is actually available.
          // This prevents unnecessary network calls for teams using only their
          // own providers (e.g. LiteLLM) via enabled_providers config.
          if (providers[ProviderID.kilo]) {
            const auth = yield* Auth.Service
            const kiloAuth = yield* auth.get("kilo")
            const token = kiloAuth?.type === "oauth" ? kiloAuth.access : kiloAuth?.key
            const organizationId = kiloAuth?.type === "oauth" ? kiloAuth.accountId : undefined
            const kiloApiDefault = yield* Effect.promise(() => fetchDefaultModel(token, organizationId))
            if (kiloApiDefault && providers[ProviderID.kilo]?.models[kiloApiDefault]) {
              defaults[ProviderID.kilo] = ModelID.make(kiloApiDefault)
            }
          }
          // kilocode_change end

          return {
            providers: Object.values(providers),
            default: defaults, // kilocode_change
          }
        }),
    ),
)
