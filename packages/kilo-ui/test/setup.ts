import { plugin } from "bun"
import { GlobalRegistrator } from "@happy-dom/global-registrator"

// The cards mount through solid-js/web, so the tests need a DOM. Bun's test
// runner does not provide one.
GlobalRegistrator.register()

// Bun's TSX loader targets solid-js/h, which evaluates provider children before
// the provider installs them. The tool cards read context in their render
// bodies, so compile JSX with Solid's own compiler instead.
const { transformAsync } = await import("@babel/core")
const solid = (await import("babel-preset-solid")).default
const typescript = (await import("@babel/preset-typescript")).default

plugin({
  name: "solid-jsx",
  setup(build) {
    build.onLoad({ filter: /\.tsx$/ }, async (args) => {
      const result = await transformAsync(await Bun.file(args.path).text(), {
        filename: args.path,
        configFile: false,
        babelrc: false,
        presets: [solid, typescript],
      })
      if (!result?.code) throw new Error(`Could not compile ${args.path}`)
      return { loader: "js", contents: result.code }
    })
  },
})

// Bun resolves the `node` export condition, which maps to Solid's server builds:
// solid-js/web throws "Client-only API" and solid-js/store fails to render.
// Point both at the browser builds used by the app.
const solidWeb = Bun.resolveSync("solid-js/web/dist/web.js", import.meta.dir)

plugin({
  name: "solid-web-browser",
  setup(build) {
    build.onResolve({ filter: /^solid-js\/web$/ }, () => ({ path: solidWeb }))
  },
})

const solidClient = Bun.resolveSync("solid-js/dist/solid.js", import.meta.dir)
const solidStore = Bun.resolveSync("solid-js/store/dist/store.js", import.meta.dir)

plugin({
  name: "solid-client",
  setup(build) {
    build.onResolve({ filter: /^solid-js$/ }, () => ({ path: solidClient }))
    build.onResolve({ filter: /^solid-js\/store$/ }, () => ({ path: solidStore }))
  },
})

// Vite's `?worker&url` import has no meaning to Bun. The file viewer only
// passes the value to a Worker constructor, so a placeholder URL is enough to
// load the real module graph.
plugin({
  name: "vite-worker-url",
  setup(build) {
    build.onResolve({ filter: /\?worker&url$/ }, (args) => ({
      path: args.path,
      namespace: "vite-worker-url",
    }))
    build.onLoad({ filter: /.*/, namespace: "vite-worker-url" }, (args) => ({
      loader: "js",
      contents: `export default ${JSON.stringify(args.path)}`,
    }))
  },
})
