if (process.env.KILO_BRANDING_TEST_HOSTED === "1") await import("../../src/branding/preload")

const relative = await import("../../../core/src/oauth/page")
const exported = await import("@opencode/core/oauth/page")
const options = { provider: "OpenCode <script>unsafe</script>", autoClose: false }
console.log(
  JSON.stringify({
    relative: relative.success(options),
    success: exported.success(options),
    error: exported.error("<img src=x onerror=alert(1)>", options),
    bootstrap: exported.bootstrap({ provider: "</script><script>unsafe</script>", tokenPath: "/callback" }),
  }),
)
