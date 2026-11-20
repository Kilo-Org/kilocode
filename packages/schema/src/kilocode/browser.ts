export * as KiloBrowserRpc from "./browser.js"

import { Schema } from "effect"
import { Rpc } from "../rpc.js"
import { optional } from "../schema.js"
import { SessionID } from "../session-id.js"

// The `kilocode.browser` RPC: what the browser backends can do right now. A settings editor reads it so a backend is
// never shown as ready from the config alone; the Playwright answer is the same `locate` check the backend runs before
// it launches, so the dialog and a `browser_*` call agree on whether a browser exists.
const portable = Schema.toStandardSchemaV1

/** The executable the Playwright backend starts: a system channel, or the Chromium the CLI installed. */
export const Target = Schema.Literals(["chrome", "msedge", "chromium"])
export type Target = typeof Target.Type

export const Playwright = Schema.Struct({
  ready: Schema.Boolean,
  /** Omitted while no browser is found. */
  target: optional(Target),
})
export type Playwright = typeof Playwright.Type

/** The extension backend's readiness, read from the hub connection: the extension reports itself when it connects. */
export const Extension = Schema.Struct({
  ready: Schema.Boolean,
  /** Omitted while no extension is connected. */
  profileLabel: optional(Schema.String),
  contractSha: optional(Schema.String),
  extensionVersion: optional(Schema.String),
})
export type Extension = typeof Extension.Type

/** The backend the tools run on. */
export const Backend = Schema.Literals(["playwright", "extension", "off"])
export type Backend = typeof Backend.Type

/** The organization's browser policy, as the cloud API answers it. */
export const Organization = Schema.Struct({
  control: Schema.Literals(["allow", "playwright_only", "off"]),
  /** Origins the organization grants every class on without a prompt. */
  origins: Schema.Array(Schema.String),
})
export type Organization = typeof Organization.Type

export const Status = Schema.Struct({
  playwright: Playwright,
  /** The extension backend: connected or not, so an editor never guesses from the config alone. */
  extension: optional(Extension),
  /** The backend in force: the config's choice, narrowed by the organization policy. */
  backend: Backend,
  /** Omitted while the organization sets no policy for the signed-in account. */
  organization: optional(Organization),
})
export type Status = typeof Status.Type

const Session = Schema.Struct({ sessionID: SessionID })

/** The extension backend could not be reached; `hint` is the setup step the UI shows. */
const Unavailable = Schema.Struct({ kind: Schema.Literal("unavailable"), hint: Schema.String })
/** The browser refused the request; `message` says why, in plain words. */
const Refused = Schema.Struct({ kind: Schema.Literal("refused"), message: Schema.String })
/** Sharing and adopting move tabs of the user's own browser, so they need the extension backend. */
const NotExtension = Schema.Struct({ kind: Schema.Literal("not_extension") })
/** The organization turned browser control off, so no choice in `/browser` can share or adopt. */
const OrganizationOff = Schema.Struct({ kind: Schema.Literal("organization_off") })

/** `/browser share`: the browser's active tab joined the session's tab group. */
export const Share = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("shared") }),
  Unavailable,
  Refused,
  NotExtension,
  OrganizationOff,
])
export type Share = typeof Share.Type

/**
 * `/browser adopt`: `adopted` re-keyed the most recent ended group to the session, `none` found no ended group, `kept`
 * left a session that already owns tabs with them, and `unconfirmed` is an extension too old to say which.
 */
export const Adopt = Schema.Union([
  Schema.Struct({ kind: Schema.Literals(["adopted", "none", "kept", "unconfirmed"]) }),
  Unavailable,
  Refused,
  NotExtension,
  OrganizationOff,
])
export type Adopt = typeof Adopt.Type

/**
 * A browser call failed in a way the user, not the model, has to act on: no browser reachable (`hint` is the setup
 * step), an extension too old for this CLI (`hint` is the update step), or the user stopped the session's browser.
 */
export const Notice = Schema.Union([
  Schema.Struct({ kind: Schema.Literals(["unavailable", "outdated"]), sessionID: SessionID, hint: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("stopped"), sessionID: SessionID }),
])
export type Notice = typeof Notice.Type

export const Definition = Rpc.define({
  id: "kilocode.browser",
  methods: {
    /** Read-only: checks the browser location, and starts nothing. */
    status: {
      input: portable(Schema.Struct({})),
      output: portable(Status),
    },
    /** Moves the browser's active tab into the session's tab group. */
    share: {
      input: portable(Session),
      output: portable(Share),
    },
    /**
     * Gives the session the most recent ended tab group. Lifts the session's stop only when the session then has tabs
     * (`adopted`, or `kept` its own); `none` and `unconfirmed` leave it stopped.
     */
    adopt: {
      input: portable(Session),
      output: portable(Adopt),
    },
  },
  events: {
    notice: { schema: portable(Notice) },
  },
})
