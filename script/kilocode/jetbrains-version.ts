// kilocode_change - new file
// Versions of JetBrains release tags: x.y.z and x.y.z-rc.n. This module imports nothing, so
// prepare-jetbrains-release.yml runs script/jetbrains-release-pr.ts without installing packages
// while the job holds the Kilo Maintainer app key and may request OIDC tokens.

export type Version = { major: number; minor: number; patch: number; rc?: number }

const pattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-rc\.(0|[1-9]\d*))?$/

export function parse(text: string): Version | undefined {
  const match = pattern.exec(text)
  if (!match) return undefined
  const [major, minor, patch, rc] = match.slice(1).map((item) => (item === undefined ? undefined : Number(item)))
  if (![major, minor, patch, rc].every((item) => item === undefined || Number.isSafeInteger(item))) return undefined
  return { major: major!, minor: minor!, patch: patch!, rc }
}

// A release sorts after every release candidate of the same x.y.z.
export function compare(a: Version, b: Version) {
  if (a.major !== b.major) return a.major - b.major
  if (a.minor !== b.minor) return a.minor - b.minor
  if (a.patch !== b.patch) return a.patch - b.patch
  if (a.rc === b.rc) return 0
  if (a.rc === undefined) return 1
  if (b.rc === undefined) return -1
  return a.rc - b.rc
}

// The tag a changelog for `ver` starts from: the newest earlier release, or for a release candidate
// the newest earlier candidate of the same x.y.z, else the newest earlier release.
export function previous(ver: string, kind: "rc" | "stable", tags: string[]) {
  const want = parse(ver)
  if (!want) throw new Error(`Invalid version: ${ver}`)
  const list = tags
    .map((tag) => ({ tag, ver: parse(tag.replace(/^jetbrains\/v/, "")) }))
    .filter((item): item is { tag: string; ver: Version } => item.ver !== undefined && compare(item.ver, want) < 0)
    .sort((a, b) => compare(b.ver, a.ver))
  const stable = list.find((item) => item.ver.rc === undefined)
  if (kind === "stable") return stable?.tag
  const rc = list.find(
    (item) =>
      item.ver.rc !== undefined &&
      item.ver.major === want.major &&
      item.ver.minor === want.minor &&
      item.ver.patch === want.patch,
  )
  return (rc ?? stable)?.tag
}
