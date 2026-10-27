if (process.env.KILO_BRANDING_TEST_HOSTED === "1") await import("../../src/branding/preload")

const relative = await import("../../../core/src/oauth/page")
const exported = await import("@opencode/core/oauth/page")
const { cliErrorMessage } = await import("../../../tui/src/util/error")
const { epilogue } = await import("../../../tui/src/util/presentation")
const options = { provider: "OpenCode <script>unsafe</script>", autoClose: false }
console.log(
  JSON.stringify({
    update: epilogue({ updatedVersion: "2.1.4" }),
    updateSession: epilogue({ updatedVersion: "2.1.4", session: { title: "Test", sessionID: "test-session" } }),
    relative: relative.success(options),
    success: exported.success(options),
    error: exported.error("<img src=x onerror=alert(1)>", options),
    bootstrap: exported.bootstrap({ provider: "</script><script>unsafe</script>", tokenPath: "/callback" }),
    modelError: cliErrorMessage({ _tag: "ProviderModelNotFoundError", providerID: "test", modelID: "missing" }),
  }),
)
