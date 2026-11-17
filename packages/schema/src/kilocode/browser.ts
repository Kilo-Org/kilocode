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

export const Status = Schema.Struct({ playwright: Playwright })
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
