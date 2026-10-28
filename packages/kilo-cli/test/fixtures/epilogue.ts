declare const KILO_BRANDING_COMPILED: boolean

const columns = Number(process.argv[2])
if (columns > 0) Object.defineProperty(process.stdout, "columns", { value: columns, configurable: true })
else if (columns === 0) Object.defineProperty(process.stdout, "columns", { value: undefined, configurable: true })

if (typeof KILO_BRANDING_COMPILED === "undefined")
  await import(process.env.KILO_BRANDING_TEST_HOSTED === "1" ? "../../src/branding/preload" : "@opentui/solid/preload")

const { epilogue } = await import("../../../tui/src/util/presentation")
const scenario = process.argv[3] ?? "session"
const text = epilogue({
  ...(scenario === "session" || scenario === "both"
    ? { session: { title: "Review fixture", sessionID: "ses_example" } }
    : {}),
  ...(scenario === "update" || scenario === "both" ? { updatedVersion: "2.1.4" } : {}),
})
if (text) console.log(text)
