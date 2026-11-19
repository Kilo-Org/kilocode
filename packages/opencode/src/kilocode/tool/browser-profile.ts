import { HttpClient } from "effect/unstable/http"
import { Effect, Schema } from "effect"
import { Env } from "@/env"
import { InstanceState } from "@/effect/instance-state"
import * as Network from "@/kilocode/sandbox/network"
import { Tool } from "@/tool/tool"
import DESCRIPTION from "./browser-profile.txt"

const Browser = Schema.Literals(["chrome", "chromium", "msedge", "firefox", "webkit"])

const Parameters = Schema.Struct({
  browser: Schema.optional(
    Browser.annotate({
      description:
        "Browser to start or switch to. Only browsers the user allowed are accepted. Required for the first call. Omit later to keep the current browser.",
    }),
  ),
  device: Schema.optional(
    Schema.String.check(Schema.isMaxLength(100)).annotate({
      description:
        'Playwright device to emulate, for example "iPhone 15", "Pixel 7", or "iPad Pro 11". Omit for a desktop browser.',
    }),
  ),
  width: Schema.optional(
    Schema.Int.check(Schema.isBetween({ minimum: 64, maximum: 3840 })).annotate({
      description: "Viewport width in CSS pixels. Requires height. Omit for the browser or device default.",
    }),
  ),
  height: Schema.optional(
    Schema.Int.check(Schema.isBetween({ minimum: 64, maximum: 2160 })).annotate({
      description: "Viewport height in CSS pixels. Requires width.",
    }),
  ),
  headless: Schema.optional(
    Schema.Boolean.annotate({
      description:
        "Run without a visible browser window. Omit or pass false to show the window, which is the default. Pass true only when the user asks for it or no display is available.",
    }),
  ),
})

const State = Schema.Struct({
  browser: Schema.optional(Browser),
  device: Schema.optional(Schema.String),
  viewport: Schema.optional(Schema.String),
  headless: Schema.optional(Schema.Boolean),
  allowed: Schema.Array(Browser),
  changed: Schema.Boolean,
})

type Meta = {
  browser?: string
  device?: string
  viewport?: string
  headless?: boolean
  changed: boolean
}

function label(state: { browser: string; device?: string; viewport?: string; headless?: boolean }) {
  return [state.browser, state.device, state.viewport, state.headless ? "headless" : undefined]
    .filter(Boolean)
    .join(", ")
}

export const BrowserProfileTool = Tool.define<
  typeof Parameters,
  Meta,
  HttpClient.HttpClient | Env.Service,
  "browser_profile"
>(
  "browser_profile",
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient
    const env = yield* Env.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context
          const bridge = yield* Network.bridge(env)
          if (!bridge) {
            return {
              title: "Browser profile unavailable",
              output: "Browser Automation is not available in this session.",
              metadata: { changed: false } satisfies Meta,
            }
          }
          if ((params.width === undefined) !== (params.height === undefined)) {
            return {
              title: "Browser size invalid",
              output: "Pass both width and height, or neither.",
              metadata: { changed: false } satisfies Meta,
            }
          }
          const viewport =
            params.width !== undefined && params.height !== undefined ? `${params.width}x${params.height}` : undefined

          return yield* Effect.gen(function* () {
            const response = yield* Network.profile(
              http,
              bridge.url,
              bridge.token,
              {
                sessionID: ctx.sessionID,
                directory: instance.directory,
                browser: params.browser,
                device: params.device,
                viewport,
                headless: params.headless,
              },
              ctx.abort,
            )
            const error = yield* Network.refusal(response)
            if (error) {
              return {
                title: "Browser profile not changed",
                output: `The browser profile was not changed: ${error}`,
                metadata: { changed: false } satisfies Meta,
              }
            }

            const state = yield* Schema.decodeUnknownEffect(State)(yield* response.json)
            const browser = state.browser
            if (!browser) {
              return {
                title: "No browser started",
                output: [
                  "No browser is running yet, so the Playwright browser tools are not available.",
                  `Allowed browsers: ${state.allowed.join(", ")}.`,
                  "Call browser_profile with one of these browsers to start it.",
                ].join("\n"),
                metadata: { changed: false } satisfies Meta,
              }
            }
            return {
              title: `Browser: ${label({ ...state, browser })}`,
              output: [
                `Browser profile: ${browser}.`,
                `Device emulation: ${state.device ?? "none (desktop)"}.`,
                `Viewport: ${state.viewport ?? "default"}.`,
                `Window: ${state.headless ? "headless (not visible)" : "visible"}.`,
                `Allowed browsers: ${state.allowed.join(", ")}.`,
                state.changed
                  ? "The browser started with this profile. The Playwright browser tools (kilo-playwright_browser_*) are available from your next step. Pages, cookies, and logins from a previous profile are gone, so navigate again."
                  : "The browser was not restarted.",
                "State this browser, device, and viewport when you report results or screenshots.",
              ].join("\n"),
              metadata: {
                browser,
                device: state.device,
                viewport: state.viewport,
                headless: state.headless,
                changed: state.changed,
              } satisfies Meta,
            }
          }).pipe(
            Effect.catch((error) =>
              Effect.succeed({
                title: "Browser profile not changed",
                output: `The browser profile request failed: ${error.message.slice(0, 500)}`,
                metadata: { changed: false } satisfies Meta,
              }),
            ),
          )
        }).pipe(Effect.orDie),
    }
  }),
)
