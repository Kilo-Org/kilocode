import { isIP } from "node:net"
import { isPublicAddress } from "@kilocode/sandbox/destination"
import { HttpClient } from "effect/unstable/http"
import { Effect, Schema } from "effect"
import { Env } from "@/env"
import { InstanceState } from "@/effect/instance-state"
import * as Network from "@/kilocode/sandbox/network"
import { Tool } from "@/tool/tool"
import DESCRIPTION from "./browser-open.txt"

const Parameters = Schema.Struct({
  url: Schema.String.annotate({
    description: "Public HTTPS URL or HTTP loopback URL for a local application, for example http://localhost:3000.",
  }),
})

const State = Schema.Struct({
  browserId: Schema.String,
  sessionId: Schema.String,
  status: Schema.Literals(["starting", "ready", "loading", "error", "closed"]),
  url: Schema.optional(Schema.String),
  title: Schema.optional(Schema.String),
  screenshot: Schema.optional(Schema.String.check(Schema.isMaxLength(3 * 1024 * 1024))),
  mime: Schema.optional(Schema.Literal("image/jpeg")),
  errors: Schema.Number,
  logs: Schema.optional(Schema.Array(Schema.String.check(Schema.isMaxLength(1000)))),
  error: Schema.optional(Schema.String),
})

type Meta = {
  browserId?: string
  status: Schema.Schema.Type<typeof State>["status"]
  url?: string
  title?: string
  errors: number
}

export const BrowserOpenTool = Tool.define<
  typeof Parameters,
  Meta,
  HttpClient.HttpClient | Env.Service,
  "browser_open"
>(
  "browser_open",
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient
    const env = yield* Env.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context
          const base = yield* env.get("KILO_BROWSER_BROKER_URL")
          const token = yield* env.get("KILO_BROWSER_BROKER_TOKEN")
          const broker = base && URL.canParse(base) ? new URL(base) : undefined
          if (
            !broker ||
            !token ||
            broker.protocol !== "http:" ||
            broker.hostname !== "127.0.0.1" ||
            !broker.port ||
            broker.username ||
            broker.password ||
            broker.pathname !== "/" ||
            broker.search ||
            broker.hash
          ) {
            return {
              title: "Browser unavailable",
              output: "The Agent Manager browser is not available in this session.",
              metadata: { status: "error", errors: 0 } satisfies Meta,
            }
          }

          const url = URL.parse(params.url)
          if (!url) {
            return {
              title: "Browser URL invalid",
              output: "Use a public HTTPS URL or an HTTP localhost URL.",
              metadata: { status: "error", errors: 0 } satisfies Meta,
            }
          }
          const host = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "")
          const local = url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)
          const remote =
            url.protocol === "https:" &&
            host !== "localhost" &&
            !host.endsWith(".localhost") &&
            (!isIP(host) || isPublicAddress(host))
          if ((!local && !remote) || url.username || url.password) {
            return {
              title: "Browser URL blocked",
              output:
                "Use public HTTPS or HTTP localhost without credentials. Private remote destinations are blocked.",
              metadata: { status: "error", errors: 0 } satisfies Meta,
            }
          }

          yield* ctx.ask({
            permission: "browser_open",
            patterns: [`navigate:${url.origin}`],
            always: [],
            metadata: { operation: "open", url: params.url },
          })

          return yield* Effect.gen(function* () {
            const response = yield* Network.broker(
              http,
              broker,
              token,
              { sessionID: ctx.sessionID, directory: instance.directory, url: params.url },
              ctx.abort,
            )
            if (response.status < 200 || response.status >= 300) {
              const body = yield* response.json.pipe(Effect.orElseSucceed(() => undefined))
              const error =
                typeof body === "object" && body !== null && "error" in body && typeof body.error === "string"
                  ? body.error
                  : `HTTP ${response.status}`
              return {
                title: "Browser open failed",
                output: `The browser could not open the page: ${error}`,
                metadata: { status: "error", errors: 0 } satisfies Meta,
              }
            }

            const state = yield* Schema.decodeUnknownEffect(State)(yield* response.json)
            return {
              title: state.title ?? state.url ?? "Browser opened",
              output: [
                `Browser status: ${state.status}.`,
                state.url ? `URL: ${state.url}.` : undefined,
                state.title ? `Title: ${state.title}.` : undefined,
                state.errors > 0 ? `Console errors: ${state.errors}.` : undefined,
                state.logs?.length
                  ? `Console diagnostics:\n${state.logs.map((line) => `- ${line}`).join("\n")}`
                  : undefined,
                "The user can inspect this page in the Agent Manager Browser panel.",
              ]
                .filter(Boolean)
                .join("\n"),
              metadata: {
                browserId: state.browserId,
                status: state.status,
                url: state.url,
                title: state.title,
                errors: state.errors,
              },
              attachments: state.screenshot
                ? [{ type: "file" as const, mime: state.mime ?? "image/jpeg", url: state.screenshot }]
                : undefined,
            }
          }).pipe(
            Effect.catch((error) =>
              Effect.succeed({
                title: "Browser open failed",
                output: `The browser could not open the page: ${error.message.slice(0, 500)}`,
                metadata: { status: "error", errors: 0 } satisfies Meta,
              }),
            ),
          )
        }).pipe(Effect.orDie),
    }
  }),
)
