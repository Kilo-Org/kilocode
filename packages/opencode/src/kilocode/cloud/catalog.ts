import {
  buildKiloHeaders,
  DEFAULT_KILO_API_URL,
  getDefaultHeaders,
  getKiloUrlFromToken,
  resolveKiloOpenRouterBaseUrl,
} from "@kilocode/kilo-gateway"
import { Context, Effect, Layer, Redacted, Schema } from "effect"
import z from "zod"
import type { CloudAuth } from "./auth"
import { parseServiceOrigin } from "./origin"
import { readBoundedJson } from "./response-json"

export namespace CloudCatalog {
  const TIMEOUT = 10_000

  const Models = z.object({
    data: z.array(
      z.object({
        id: z.string().min(1).max(255),
        architecture: z
          .object({
            output_modalities: z.array(z.string()).nullish(),
          })
          .optional(),
        supported_parameters: z.array(z.string()).optional(),
      }),
    ),
  })
  const Defaults = z.object({
    defaultModel: z.string().min(1).max(255),
  })

  export type Environment = Readonly<Record<string, string | undefined>>
  export type Fetch = (request: Request) => Promise<Response>

  export interface Options {
    readonly env?: Environment
    readonly fetch?: Fetch
  }

  export interface Input extends CloudAuth.Resolved {}

  export class CatalogError extends Schema.TaggedErrorClass<CatalogError>()("CloudCatalogError", {
    kind: Schema.Literals(["auth", "network", "schema", "http"]),
    status: Schema.optional(Schema.Number),
    message: Schema.String,
  }) {}

  export interface Interface {
    readonly models: (input: Input) => Effect.Effect<readonly string[], CatalogError>
    readonly defaultModel: (input: Input) => Effect.Effect<string, CatalogError>
  }

  export class Service extends Context.Service<Service, Interface>()("@kilocode/CloudCatalog") {}

  export const layer = (options: Options = {}) => {
    const fetcher = options.fetch ?? ((request: Request) => globalThis.fetch(request))
    const env = options.env ?? process.env

    const request = Effect.fn("CloudCatalog.request")(function* <A>(url: string, input: Input, schema: z.ZodType<A>) {
      const req = yield* Effect.try({
        try: () =>
          new Request(url, {
            headers: {
              ...getDefaultHeaders(),
              ...buildKiloHeaders(
                undefined,
                input.organizationID ? { kilocodeOrganizationId: input.organizationID } : undefined,
              ),
              "X-KILOCODE-FEATURE": "kilo-cli",
              Authorization: `Bearer ${Redacted.value(input.token)}`,
            },
            redirect: "error",
            signal: AbortSignal.timeout(TIMEOUT),
          }),
        catch: () =>
          new CatalogError({
            kind: "schema",
            message: "Kilo catalog URL is invalid",
          }),
      })
      const response = yield* Effect.tryPromise({
        try: () => fetcher(req),
        catch: () =>
          new CatalogError({
            kind: "network",
            message: "Unable to reach the Kilo model catalog",
          }),
      })
      if (!response.ok) {
        const kind = response.status === 401 || response.status === 403 ? "auth" : "http"
        return yield* Effect.fail(
          new CatalogError({
            kind,
            status: response.status,
            message:
              kind === "auth"
                ? "Kilo credentials or organization were rejected by the model catalog"
                : "The Kilo model catalog is unavailable",
          }),
        )
      }

      const body = yield* Effect.tryPromise({
        try: () => readBoundedJson(response),
        catch: () =>
          new CatalogError({
            kind: "schema",
            message: "The Kilo model catalog returned an invalid response",
          }),
      })
      const parsed = schema.safeParse(body)
      if (!parsed.success) {
        return yield* Effect.fail(
          new CatalogError({
            kind: "schema",
            message: "The Kilo model catalog returned an invalid response",
          }),
        )
      }
      return parsed.data
    })

    const base = Effect.fn("CloudCatalog.base")(function* (input: Input) {
      const raw = env.KILO_API_URL?.trim()
      const fallback = raw || DEFAULT_KILO_API_URL
      const value = getKiloUrlFromToken(fallback, Redacted.value(input.token))
      return yield* Effect.try({
        try: () => {
          const url = new URL(resolveKiloOpenRouterBaseUrl({ baseURL: value }))
          parseServiceOrigin(url.origin, { allowHttpLoopback: !!raw || value !== fallback })
          if (url.username !== "" || url.password !== "") throw new Error("Catalog URL credentials are not allowed")
          return url
        },
        catch: () =>
          new CatalogError({
            kind: "schema",
            message: "Kilo catalog URL must be secure",
          }),
      })
    })

    const models = Effect.fn("CloudCatalog.models")(function* (input: Input) {
      const root = yield* base(input)
      const path = input.organizationID
        ? `../organizations/${encodeURIComponent(input.organizationID)}/models`
        : "models"
      const result = yield* request(new URL(path, root).toString(), input, Models)
      return [
        ...new Set(
          result.data
            .filter(
              (model) =>
                !model.architecture?.output_modalities?.includes("image") &&
                model.supported_parameters?.includes("tools"),
            )
            .map((model) => model.id),
        ),
      ]
    })

    const defaultModel = Effect.fn("CloudCatalog.defaultModel")(function* (input: Input) {
      const root = yield* base(input)
      const path = input.organizationID
        ? `../organizations/${encodeURIComponent(input.organizationID)}/defaults`
        : "../defaults"
      return (yield* request(new URL(path, root).toString(), input, Defaults)).defaultModel
    })

    return Layer.succeed(Service, Service.of({ models, defaultModel }))
  }
}
