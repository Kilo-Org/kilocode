import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { Config } from "../../config/config"
import { Provider } from "../../provider/provider"
import { mapValues } from "remeda"
import { errors } from "../error"
import { Log } from "../../util/log"
import { lazy } from "../../util/lazy"
// kilocode_change start
import { fetchDefaultModel } from "@kilocode/kilo-gateway"
import { Auth } from "../../auth"
// kilocode_change end

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

        // kilocode_change start - Fetch default model from Kilo API
        const kiloAuth = await Auth.get("kilo")
        const token = kiloAuth?.type === "oauth" ? kiloAuth.access : kiloAuth?.key
        const organizationId = kiloAuth?.type === "oauth" ? kiloAuth.accountId : undefined
        const kiloApiDefault = await fetchDefaultModel(token, organizationId)
        // kilocode_change end

        // kilocode_change start - Use API default for Kilo provider if valid
        const defaults = mapValues(providers, (item) => Provider.sort(Object.values(item.models))[0].id)
        if (kiloApiDefault && providers["kilo"]?.models[kiloApiDefault]) {
          defaults["kilo"] = kiloApiDefault
        }
        // kilocode_change end

        return c.json({
          providers: Object.values(providers),
          default: defaults,
        })
      },
    ),
)
