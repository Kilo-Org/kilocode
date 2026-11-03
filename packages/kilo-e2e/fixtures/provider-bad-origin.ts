import { provider } from "./provider-lib"

if (import.meta.main) await provider("bad-origin")
