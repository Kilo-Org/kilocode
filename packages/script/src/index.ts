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
  KILO_PRE_RELEASE: process.env["KILO_PRE_RELEASE"],
}
// kilocode_change end
const CHANNEL = await (async () => {
  if (env.KILO_CHANNEL) return env.KILO_CHANNEL // kilocode_change
  // kilocode_change start - publish to "rc" channel for pre-releases
  if (env.KILO_PRE_RELEASE === "true") return "rc"
  // kilocode_change end
  if (env.KILO_BUMP) return "latest" // kilocode_change
  if (env.KILO_VERSION && !env.KILO_VERSION.startsWith("0.0.0-")) return "latest" // kilocode_change
  return await $`git branch --show-current`.text().then((x) => x.trim())
})()
const IS_PREVIEW = CHANNEL !== "latest"

// kilocode_change start - shared helpers for version computation
function parseVersion(input: string) {
  const match = input.trim().match(/^v?(\d+)\.(\d+)\.(\d+)$/)
  if (!match) return
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    value: `${match[1]}.${match[2]}.${match[3]}`,
  }
}

function compareVersion(
  a: NonNullable<ReturnType<typeof parseVersion>>,
  b: NonNullable<ReturnType<typeof parseVersion>>,
) {
  if (a.major !== b.major) return a.major - b.major
  if (a.minor !== b.minor) return a.minor - b.minor
  return a.patch - b.patch
}

async function fetchLatest() {
  const data: any = await fetch("https://registry.npmjs.org/@kilocode/cli/latest").then((res) => {
    if (!res.ok) throw new Error(res.statusText)
    return res.json()
  })
  return data.version as string
}

async function fetchHighest() {
  if (!env.KILO_RELEASE || !process.env.GH_REPO) return fetchLatest()
  const data: { tagName: string }[] = await $`gh release list --json tagName --limit 100 --repo ${process.env.GH_REPO}`
    .json()
    .catch(() => [])
  const versions = data.flatMap((item) => {
    const version = parseVersion(item.tagName)
    if (!version) return []
    return [version]
  })
  const highest = versions.sort(compareVersion).at(-1)
  if (highest) return highest.value
  return fetchLatest()
}

function bumpVersion(current: string, type: string) {
  const version = parseVersion(current)
  if (!version) throw new Error(`Invalid version: ${current}`)
  if (type === "major") return `${version.major + 1}.0.0`
  if (type === "minor") return `${version.major}.${version.minor + 1}.0`
  return `${version.major}.${version.minor}.${version.patch + 1}`
}
// kilocode_change end

const VERSION = await (async () => {
  if (env.KILO_VERSION) return env.KILO_VERSION // kilocode_change
  if (IS_PREVIEW) {
    // kilocode_change start - rc releases use plain semver required by VS Code Marketplace
    if (env.KILO_BUMP && env.KILO_PRE_RELEASE === "true") {
      const current = await fetchHighest()
      return bumpVersion(current, env.KILO_BUMP.toLowerCase())
    }
    // kilocode_change end
    return `0.0.0-${CHANNEL}-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")}`
  }
  const version = await fetchHighest() // kilocode_change
  return bumpVersion(version, env.KILO_BUMP?.toLowerCase() ?? "patch") // kilocode_change
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
