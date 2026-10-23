import "../../src/branding/probe-preload"

const relative = await import("../../../tui/src/logo")
const exported = await import("@opencode/tui/logo")
console.log(JSON.stringify({ relative, exported }))
