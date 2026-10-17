import path from "node:path"
import { build } from "esbuild"
import { solidPlugin } from "esbuild-plugin-solid"

export async function serve() {
  const root = path.resolve(import.meta.dir, "../..")
  const solid = path.dirname(Bun.resolveSync("solid-js/package.json", root))
  const aliases: Record<string, string> = {
    "solid-js": path.join(solid, "dist/solid.js"),
    "solid-js/web": path.join(solid, "web/dist/web.js"),
    "solid-js/store": path.join(solid, "store/dist/store.js"),
  }
  const result = await build({
    entryPoints: [path.join(import.meta.dir, "response-lens-visual.tsx")],
    bundle: true,
    conditions: ["browser"],
    format: "esm",
    platform: "browser",
    outdir: path.join(root, ".response-lens-visual"),
    write: false,
    loader: { ".woff": "dataurl", ".woff2": "dataurl", ".ttf": "dataurl", ".svg": "dataurl" },
    plugins: [
      {
        name: "browser-fixture",
        setup(context) {
          context.onResolve({ filter: /^solid-js(\/web|\/store)?$/ }, (args) => ({ path: aliases[args.path] }))
          context.onResolve({ filter: /^@/, namespace: "file" }, (args) => {
            if (args.kind === "import-rule")
              return context.resolve(args.path, { kind: "import-statement", resolveDir: args.resolveDir })
          })
          context.onResolve({ filter: /\?worker&url$/ }, (args) => ({ path: args.path, namespace: "worker-url" }))
          context.onLoad({ filter: /.*/, namespace: "worker-url" }, () => ({
            contents: "export default undefined",
            loader: "js",
          }))
        },
      },
      solidPlugin(),
    ],
    target: "es2022",
    logLevel: "silent",
  })
  const assets = new Map(result.outputFiles.map((file) => [`/${path.basename(file.path)}`, file]))
  return Bun.serve({
    hostname: "127.0.0.1",
    port: Number(process.env["RESPONSE_LENS_VISUAL_PORT"] ?? 0),
    fetch(request) {
      const pathname = new URL(request.url).pathname
      const asset = assets.get(pathname)
      if (asset)
        return new Response(asset.contents, {
          headers: { "content-type": pathname.endsWith(".css") ? "text/css" : "text/javascript" },
        })
      if (pathname !== "/") return new Response("Not found", { status: 404 })
      return new Response(
        `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Response Lens visual fixture</title><link rel="stylesheet" href="/response-lens-visual.css"><style>
        body { margin: 0; background: var(--vscode-editor-background); color: var(--vscode-editor-foreground); font-family: "Segoe UI", sans-serif; }
        .visual-fixture { padding: 20px; max-width: 640px; margin: auto; }
        .visual-fixture h1 { font-size: 14px; font-weight: 600; margin: 0 0 4px; }
        .visual-fixture header p { font-size: 11px; color: var(--vscode-descriptionForeground); }
        .visual-transcript { margin-top: 240px; font-size: 13px; line-height: 1.6; }
        .visual-dock { margin-top: 180px; }
      </style></head><body><div id="root"></div><script type="module" src="/response-lens-visual.js"></script></body></html>`,
        { headers: { "content-type": "text/html" } },
      )
    },
  })
}

if (import.meta.main) {
  const server = await serve()
  console.log(`Response Lens fixture: ${server.url}`)
}
