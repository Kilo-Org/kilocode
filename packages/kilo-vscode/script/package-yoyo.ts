/**
 * 打包企业版 VSIX：官方 Kilo 7.3.x + gatekeeper，publisher 为 yoyo-local。
 * 用法：bun run package:yoyo
 */
import { $ } from "bun"
import { readFileSync, writeFileSync } from "fs"
import { join } from "path"

const root = join(import.meta.dir, "..")
const pkgPath = join(root, "package.json")
const raw = readFileSync(pkgPath, "utf8")

const WAB = "https://wab.flyfishphp.cn"

const pkg = JSON.parse(raw) as Record<string, unknown>
const ver = String(pkg.version ?? "0.0.0")
pkg.publisher = "yoyo-local"
pkg.name = "yoyo-code"
pkg.displayName = "yoyo code"
pkg.version = ver.includes("-") ? ver.replace(/-enterprise\.\d+$/, "-enterprise.2") : `${ver}-enterprise.2`

const props = (pkg.contributes as { configuration?: { properties?: Record<string, { default?: unknown }> } })
  ?.configuration?.properties
if (props) {
  const set = (key: string, value: unknown) => {
    if (props[key]) props[key].default = value
  }
  set("kilo-code.new.gatekeeper.enabled", true)
  set("kilo-code.new.gatekeeper.gatewayUrl", WAB)
  set("kilo-code.new.gatekeeper.platformUrl", WAB)
  set("kilo-code.new.gatekeeper.enginePath", "/kilo")
  set("kilo-code.new.enterprise.license.enabled", true)
  set("kilo-code.new.enterprise.license.serverUrl", WAB)
  set("kilo-code.new.enterprise.license.key", "poc-demo-key")
}

writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`)

try {
  console.log("[package-yoyo] building extension...")
  await $`node esbuild.js --production`.cwd(root)
  const out = join(root, `yoyo-code-${pkg.version}.vsix`)
  console.log("[package-yoyo] packaging", out)
  await $`bunx vsce package --no-dependencies --skip-license -o ${out}`.cwd(root)
  console.log("[package-yoyo] done:", out)
} finally {
  writeFileSync(pkgPath, raw)
}
