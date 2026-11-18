export * as KiloBrowserRpc from "./browser.js"

import { Schema } from "effect"
import { Rpc } from "../rpc.js"
import { optional } from "../schema.js"

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

export const Definition = Rpc.define({
  id: "kilocode.browser",
  methods: {
    /** Read-only: checks the browser location, and starts nothing. */
    status: {
      input: portable(Schema.Struct({})),
      output: portable(Status),
    },
  },
  events: {},
})
