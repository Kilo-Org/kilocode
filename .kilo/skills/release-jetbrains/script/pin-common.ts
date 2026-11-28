import { $ } from "bun"
// Dependency-free version helpers: the jetbrains-pin job of publish.yml runs set-pin.ts, which
// imports this file, without installing packages.
import { compare, parse, type Version } from "../../../../script/kilocode/jetbrains-version"

export const assets = [
  "kilo-darwin-arm64.zip",
  "kilo-darwin-x64.zip",
  "kilo-linux-arm64.tar.gz",
  "kilo-linux-x64.tar.gz",
  "kilo-windows-arm64.zip",
  "kilo-windows-x64.zip",
]

export async function latest(repo: string) {
  const list = (await $`gh release list --repo ${repo} --limit 100 --json tagName,isDraft,isPrerelease`.json()) as {
    tagName: string
    isDraft: boolean
    isPrerelease: boolean
  }[]
  return (
    list
      .filter((item) => /^v\d+\.\d+\.\d+$/.test(item.tagName) && !item.isDraft && !item.isPrerelease)
      .map((item) => ({ tag: item.tagName.slice(1), ver: parse(item.tagName.slice(1)) }))
      .filter((item): item is { tag: string; ver: Version } => item.ver !== undefined)
      .sort((a, b) => compare(b.ver, a.ver))[0]?.tag ?? null
  )
}

export async function missing(repo: string, version: string) {
  const res = await $`gh release view ${`v${version}`} --repo ${repo} --json assets --jq ${".assets[].name"}`.quiet().nothrow()
  if (res.exitCode !== 0) return assets
  const names = res.stdout.toString().split(/\r?\n/).map((item) => item.trim()).filter(Boolean)
  return assets.filter((item) => !names.includes(item))
}
