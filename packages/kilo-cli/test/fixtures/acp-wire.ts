declare const KILO_BRANDING_COMPILED: boolean

if (typeof KILO_BRANDING_COMPILED === "undefined" && process.env.KILO_ACP_TEST_HOSTED === "1") {
  await import("../../src/preload")
}

const { startWire, rpcError } = await import("../../../cli/test/acp/wire-fixture")
await using acp = await startWire()
const plain = await acp.initialize()
const terminal = await acp.initialize({ terminalAuth: true, childSessionUpdates: true })
const standard = await acp.request("initialize", {
  protocolVersion: 1,
  clientCapabilities: { auth: { terminal: true } },
})
const both = await acp.request("initialize", {
  protocolVersion: 1,
  clientCapabilities: { auth: { terminal: true }, _meta: { "terminal-auth": true } },
})
const auth = await acp.request("authenticate", { methodId: "opencode-login" })
const invalidAuth = await rpcError(acp.request("authenticate", { methodId: "missing" }))
const session = await acp.newSession()
const list = await acp.request("session/list", { cwd: "/workspace" })
const closed = await acp.request("session/close", { sessionId: session.sessionId })
const deleted = await acp.request("session/delete", { sessionId: session.sessionId })
process.stdout.write(
  JSON.stringify({ plain, terminal, standard, both, auth, invalidAuth, session, list, closed, deleted }),
)
