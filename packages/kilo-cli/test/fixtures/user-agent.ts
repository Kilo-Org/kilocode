// Prints the general user agent of the Kilo host for the environment of this process. The environment translation
// loads first, as in the host entry (src/index.ts), so KILO_CLIENT reaches the app identity.
import "../../src/env"
import { App } from "@opencode/core/app"
import { KiloApp } from "../../src/app"

console.log(App.useragent(App.make(KiloApp)))
