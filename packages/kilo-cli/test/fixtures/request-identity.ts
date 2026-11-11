// Prints the identity headers the Kilo host puts on an `anthropic` model request, for the environment of this
// process. The environment translation loads first, as in the host entry (src/index.ts), so KILO_CLIENT reaches the
// app identity.
import "../../src/env"
import { KiloRequestIdentity } from "../../../kilo-plugin/src/request-identity"
import { KiloApp } from "../../src/app"

console.log(JSON.stringify(KiloRequestIdentity.headers("anthropic", KiloApp)))
