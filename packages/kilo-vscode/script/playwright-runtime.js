const fs = require("node:fs")
const path = require("node:path")
const { createRequire } = require("node:module")

function copy(name, from, dir) {
  const file = createRequire(path.join(from, "package.json"))
    .resolve.paths(name)
    ?.map((dir) => path.join(dir, name, "package.json"))
    .find((file) => fs.existsSync(file))
  if (!file) throw new Error(`Could not locate runtime package ${name}`)

  const root = fs.realpathSync(path.dirname(file))
  const pkg = require(file)
  const target = path.join(dir, name)
  fs.rmSync(target, { recursive: true, force: true })
  fs.cpSync(root, target, {
    recursive: true,
    dereference: true,
    // Runtime only: skip nested installs, type declarations, source maps, and zod's TypeScript sources.
    filter: (file) => {
      const base = path.basename(file)
      if (base === "node_modules") return false
      if (/\.d\.[cm]?ts$|\.map$/.test(base)) return false
      return !(name === "zod" && file === path.join(root, "src"))
    },
  })
  for (const dep of Object.keys(pkg.dependencies ?? {})) copy(dep, root, path.join(target, "node_modules"))
}

module.exports = {
  name: "playwright-runtime",
  setup(build) {
    build.onResolve({ filter: /^playwright-core(?:\/|$)/ }, (args) => ({ path: args.path, external: true }))
    build.onEnd((result) => {
      if (result.errors.length) return
      const file = path.resolve(build.initialOptions.absWorkingDir ?? process.cwd(), build.initialOptions.outfile)
      const dir = path.join(path.dirname(file), "node_modules")
      for (const name of ["playwright-core", "chromium-bidi"]) copy(name, path.join(__dirname, ".."), dir)
    })
  },
}
