declare const KILO_BRANDING_COMPILED: boolean

process.env.KILO_UNICODE_LOGO = process.argv[2]

if (typeof KILO_BRANDING_COMPILED === "undefined") await import("../../src/branding/preload")

const { make } = await import("../../../cli/src/services/update-preflight")
const preflight = make()
const outcome = process.argv[3]
if (!["finish", "fail", "close"].includes(outcome ?? "")) throw new Error("Invalid fixture outcome")

try {
  if (!preflight.begin("fixture-old")) throw new Error("Preflight requires a terminal")
  if (!preflight.begin("fixture-old")) throw new Error("Repeated begin must succeed")
  preflight.loading()
  await Bun.sleep(outcome === "close" ? 200 : 1_700)
  if (outcome === "finish") await preflight.finish()
  if (outcome === "fail") await preflight.fail("fixture startup failed")
  if (outcome === "close") await preflight.close()
} finally {
  await preflight.close()
  await preflight.close()
}

process.stdout.write(`\nfixture closed: ${outcome}\n`)
