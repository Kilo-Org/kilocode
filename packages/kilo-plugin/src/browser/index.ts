// The `browser_open` tool. The Integrated Browser is an extension-host feature: the host runs one Chromium for the
// sidebar tab and the Agent Manager panel, and serves the open operation on loopback with a per-run token. The host
// passes the endpoint to the server through the environment, so the tool exists only while the feature is enabled.
import { define } from "@opencode/plugin/effect/plugin"
import { Tool } from "@opencode/schema/tool"
import { Effect, Schema } from "effect"
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

const TIMEOUT = 60_000

export function broker(): { url: URL; token: string } | undefined {
  const base = process.env.KILO_BROWSER_BROKER_URL
  const token = process.env.KILO_BROWSER_BROKER_TOKEN
  if (!base || !token || !URL.canParse(base)) return undefined
  const url = new URL(base)
  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    !url.port ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    return undefined
  }
  return { url, token }
}

/**
 * The destination policy here is the cheap shape check only. The browser broker re-validates the URL against the
 * public and loopback rules, with DNS resolution, before it navigates.
 */
export function destination(value: string): { url: URL } | { error: string } {
  if (!URL.canParse(value)) return { error: "Use a public HTTPS URL or an HTTP localhost URL." }
  const url = new URL(value)
  // Dev servers print 0.0.0.0 when they listen on every interface. It is not a destination, so use localhost,
  // the origin that dev tools usually configure.
  if (url.protocol === "http:" && url.hostname === "0.0.0.0") url.hostname = "localhost"
  if (url.username || url.password) return { error: "Browser URLs must not contain credentials." }
  const local = url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)
  if (!local && url.protocol !== "https:") {
    return { error: "Use public HTTPS or HTTP localhost without credentials." }
  }
  return { url }
}

export async function openPage(input: {
  broker: { url: URL; token: string }
  directory: string
  sessionID: string
  url: URL
}) {
  const response = await fetch(new URL("/browser/open", input.broker.url), {
    method: "POST",
    headers: { authorization: `Bearer ${input.broker.token}`, "content-type": "application/json" },
    body: JSON.stringify({
      sessionID: input.sessionID,
      directory: input.directory,
      url: input.url.href,
      capture: false,
    }),
    signal: AbortSignal.timeout(TIMEOUT),
  })
  const body: unknown = await response.json().catch(() => undefined)
  const error =
    typeof body === "object" && body !== null && "error" in body && typeof body.error === "string"
      ? body.error
      : undefined
  if (response.status < 200 || response.status >= 300) throw new Error(error ?? `HTTP ${response.status}`)
  return Schema.decodeUnknownSync(State)(body)
}

export const KiloBrowserToolPlugin = define({
  id: "kilocode.tool-browser",
  effect: Effect.fn("KiloBrowserTool.Plugin")(function* (ctx) {
    const endpoint = broker()
    if (!endpoint) return
    const directory = ctx.location.directory

    yield* ctx.tool.transform((editor) =>
      editor.add({
        name: "browser_open",
        options: { codemode: false },
        description: DESCRIPTION,
        input: Parameters,
        output: Schema.String,
        execute: (params, context) =>
          Effect.gen(function* () {
            const target = destination(params.url)
            if ("error" in target) {
              return {
                output: target.error,
                metadata: { status: "error", errors: 0 } satisfies Meta,
              }
            }
            yield* ctx.permission.assert({
              action: "browser_open",
              resources: [`navigate:${target.url.origin}`],
              save: [`navigate:${target.url.origin}`],
              sessionID: context.sessionID,
              agent: context.agent,
              metadata: {
                operation: "open",
                url: target.url.href,
                rules: [`navigate:${target.url.origin}`, "navigate:*"],
              },
              source: { type: "tool", messageID: context.messageID, id: context.id },
            })

            const state = yield* Effect.tryPromise({
              try: () =>
                openPage({ broker: endpoint, directory, sessionID: String(context.sessionID), url: target.url }),
              catch: (cause) => new Tool.Error({ message: cause instanceof Error ? cause.message : String(cause) }),
            }).pipe(
              Effect.catch((error) =>
                Effect.succeed({
                  output: `The browser could not open the page: ${error.message.slice(0, 500)}`,
                  metadata: { status: "error", errors: 0 } satisfies Meta,
                }),
              ),
            )
            if (!("browserId" in state)) return state

            return {
              output: [
                `Browser status: ${state.status}.`,
                state.url ? `URL: ${state.url}.` : undefined,
                state.title ? `Title: ${state.title}.` : undefined,
                state.errors > 0 ? `Console errors: ${state.errors}.` : undefined,
                state.logs?.length
                  ? `Console diagnostics:\n${state.logs.map((line) => `- ${line}`).join("\n")}`
                  : undefined,
                "The user sees this page in the Integrated Browser.",
              ]
                .filter(Boolean)
                .join("\n"),
              metadata: {
                browserId: state.browserId,
                status: state.status,
                url: state.url,
                title: state.title,
                errors: state.errors,
              } satisfies Meta,
            }
          }),
      }),
    )
  }),
})