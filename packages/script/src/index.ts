import { $, semver } from "bun"
import path from "path"

const rootPkgPath = path.resolve(import.meta.dir, "../../../package.json")
const rootPkg = await Bun.file(rootPkgPath).json()
const expectedBunVersion = rootPkg.packageManager?.split("@")[1]

if (!expectedBunVersion) {
  throw new Error("packageManager field not found in root package.json")
}

// relax version requirement
const expectedBunVersionRange = `^${expectedBunVersion}`

if (!semver.satisfies(process.versions.bun, expectedBunVersionRange)) {
  throw new Error(`This script requires bun@${expectedBunVersionRange}, but you are using bun@${process.versions.bun}`)
}
// kilocode_change start
const env = {
  KILO_CHANNEL: process.env["KILO_CHANNEL"],
  KILO_BUMP: process.env["KILO_BUMP"],
  KILO_VERSION: process.env["KILO_VERSION"],
  KILO_RELEASE: process.env["KILO_RELEASE"],
}
// kilocode_change end
const CHANNEL = await (async () => {
  if (env.KILO_CHANNEL) return env.KILO_CHANNEL // kilocode_change
  if (env.KILO_BUMP) return "latest" // kilocode_change
  if (env.KILO_VERSION && !env.KILO_VERSION.startsWith("0.0.0-")) return "latest" // kilocode_change
  return await $`git branch --show-current`.text().then((x) => x.trim())
})()
const IS_PREVIEW = CHANNEL !== "latest"

const VERSION = await (async () => {
  if (env.KILO_VERSION) return env.KILO_VERSION // kilocode_change
  if (IS_PREVIEW) return `0.0.0-${CHANNEL}-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")}`
  const version = await fetch("https://registry.npmjs.org/@kilocode/cli/latest") // kilocode_change
    .then((res) => {
      if (!res.ok) throw new Error(res.statusText)
      return res.json()
    })
    .then((data: any) => data.version)
  const [major, minor, patch] = version.split(".").map((x: string) => Number(x) || 0)
  const t = env.KILO_BUMP?.toLowerCase() // kilocode_change
  if (t === "major") return `${major + 1}.0.0`
  if (t === "minor") return `${major}.${minor + 1}.0`
  return `${major}.${minor}.${patch + 1}`
})()

// kilocode_change start
const team = [
  "actions-user",
  "kilo-maintainer[bot]",
  "kiloconnect[bot]",
  "kiloconnect-lite[bot]",
  "alexkgold",
  "arimesser",
  "arkadiykondrashov",
  "bturcotte520",
  "catrielmuller",
  "chrarnoldus",
  "codingelves",
  "darkogj",
  "dosire",
  "DScdng",
  "emilieschario",
  "eshurakov",
  "Helix-Kilo",
  "iscekic",
  "jeanduplessis",
  "jobrietbergen",
  "jrf0110",
  "kevinvandijk",
  "alex-alecu",
  "imanolmzd-svg",
  "kilocode-bot",
  "kilo-code-bot[bot]",
  "kirillk",
  "lambertjosh",
  "LigiaZ",
  "marius-kilocode",
  "markijbema",
  "olearycrew",
  "pandemicsyn",
  "pedroheyerdahl",
  "RSO",
  "sbreitenother",
  "suhailkc2025",
  "Sureshkumars",
]
// kilocode_change end

export const Script = {
  get channel() {
    return CHANNEL
  },
  get version() {
    return VERSION
  },
  get preview() {
    return IS_PREVIEW
  },
  get release(): boolean {
    return !!env.KILO_RELEASE // kilocode_change
  },
  get team() {
    return team
  },
}
console.log(`kilo script`, JSON.stringify(Script, null, 2)) // kilocode_change
