import { KiloBinary } from "./binary"

declare const KILO_BRANDING_COMPILED: boolean
declare const OPENCODE_CLI_NAME: string | undefined

if (typeof KILO_BRANDING_COMPILED === "undefined") {
  if (typeof OPENCODE_CLI_NAME !== "string")
    Object.defineProperty(globalThis, "OPENCODE_CLI_NAME", { value: KiloBinary, configurable: true, writable: true })
  const { plugin } = await import("bun")
  const { hostMirrorsPlugin } = await import("./mirrors")
  plugin(hostMirrorsPlugin)
}

await import("./branding/preload")
