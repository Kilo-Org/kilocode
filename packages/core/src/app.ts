export * as App from "./app.js"

import { Context, Layer } from "effect"
import { makeGlobalNode } from "@opencode/util/effect/app-node"

export interface Info {
  readonly name: string
  readonly version: string
  readonly channel: string
  // kilocode_change start - oauth seam: how an embedder names its product in third-party sign-in (OAuth originator, consent screen, callback page)
  readonly product?: { readonly id: string; readonly name: string; readonly wordmark?: string }
  // kilocode_change end
}

export const Metadata = Context.Reference<Info>("@opencode/App", {
  defaultValue: () => make(),
})

export function make(input: Partial<Info> = {}): Info {
  return {
    name: input.name ?? "opencode",
    version: input.version ?? "unknown",
    channel: input.channel ?? "unknown",
    product: input.product, // kilocode_change(oauth) seam - pass the optional product identity through
  }
}

export function useragent(app: Info) {
  return `opencode/${app.channel}/${app.version}/${app.name}`
}

export const layer = (input?: Partial<Info>) => Layer.succeed(Metadata, make(input))

export const configured = (input?: Partial<Info>) =>
  makeGlobalNode({ service: Metadata, layer: layer(input), deps: [] })

export const node = configured()
