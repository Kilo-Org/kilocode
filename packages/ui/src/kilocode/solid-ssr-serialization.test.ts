import { describe, expect, test } from "bun:test"
import { createRequire } from "node:module"
import vm from "node:vm"

// solid-js pins seroval ~1.5.0, but the root package.json overrides seroval to the
// patched 1.6 line until solid-js itself moves past 1.9.15. Solid's server build is
// the only seroval consumer, so this renders through it end to end and replays the
// hydration script the way a browser would.
const req = createRequire(Bun.resolveSync("solid-js/package.json", import.meta.dir))
const web = await import(req.resolve("solid-js/web/dist/server.js"))
const solid = await import(req.resolve("solid-js/dist/server.js"))

describe("Solid SSR serialization", () => {
  test("round-trips resource data through the hydration script", async () => {
    const text = "</script><script>alert(1)</script>"
    const value = {
      when: new Date(0),
      map: new Map([["k", 1]]),
      url: new URL("https://x.dev/p?q=1"),
      head: new Headers({ "x-k": "v" }),
      big: 10n,
      text,
    }
    const App = () => {
      const [data] = solid.createResource(async () => value)
      return web.createComponent(solid.Suspense, {
        fallback: "loading",
        get children() {
          return web.ssr(["<p>", "</p>"], web.escape(String(data()?.map.get("k"))))
        },
      })
    }

    const html: string = await web.renderToStringAsync(() => web.createComponent(App, {}))
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1])

    expect(html.startsWith("<p>1</p>")).toBe(true)
    expect(scripts).toHaveLength(1)

    const ctx = vm.createContext({ _$HY: { r: {} }, URL, Headers, Map, Date, Promise })
    ctx.self = ctx
    vm.runInContext(scripts.join(";"), ctx)
    const keys = Object.keys(ctx._$HY.r)
    const out = await Promise.all(keys.map((key) => ctx._$HY.r[key]))
    const back = out.find((item) => item && typeof item === "object" && "when" in item)

    expect(back.when.getTime()).toBe(0)
    expect(back.map.get("k")).toBe(1)
    expect(back.url.searchParams.get("q")).toBe("1")
    expect(back.head.get("x-k")).toBe("v")
    expect(back.big).toBe(10n)
    expect(back.text).toBe(text)
  })
})
