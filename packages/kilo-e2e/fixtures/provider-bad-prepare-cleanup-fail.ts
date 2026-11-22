import { provider } from "./provider-lib"

if (import.meta.main) await provider("cleanup-fail", "bad-prepare")
