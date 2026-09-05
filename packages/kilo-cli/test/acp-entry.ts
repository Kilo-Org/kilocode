import { runAcp } from "../src/acp"

// Stands in for the command the parent slice wires: it only supplies an endpoint
// the caller already owns and forwards the bridge's exit code.
const url = process.env.KILO_ACP_TEST_URL
const password = process.env.KILO_ACP_TEST_PASSWORD
const artifact = process.env.KILO_ACP_TEST_ARTIFACT
if (!url || !password || !artifact) throw new Error("The ACP test entry requires URL, password, and artifact")
process.exitCode = await runAcp({ url, auth: { password } }, { artifact, cwd: process.cwd() })
