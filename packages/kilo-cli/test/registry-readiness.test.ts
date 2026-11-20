import { afterEach, describe, expect, test } from "bun:test"
import { refuseStale, stale, taggedVersion, waitForRegistry } from "../script/registry-readiness"

const servers: Array<ReturnType<typeof Bun.serve>> = []

afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true)
})

function serve(handler: (request: Request) => Response | Promise<Response>) {
  const server = Bun.serve({ port: 0, fetch: handler })
  servers.push(server)
  return server
}

function document(name: string, version: string, tarball: string) {
  return Response.json({ name, versions: { [version]: { name, version, dist: { tarball } } } })
}

function tarballPath(name: string, version: string) {
  return `/${name}/-/${name.slice(name.lastIndexOf("/") + 1)}-${version}.tgz`
}

describe("waitForRegistry", () => {
  test("passes once the install document lists the exact version and its canonical tarball", async () => {
    const paths: string[] = []
    const accepts: Array<string | null> = []
    const ranges: Array<string | null> = []
    const server = serve((request) => {
      const url = new URL(request.url)
      const path = decodeURIComponent(url.pathname)
      paths.push(path)
      if (path === "/@kilocode/cli-test") {
        accepts.push(request.headers.get("accept"))
        return document("@kilocode/cli-test", "1.0.0", `${url.origin}${tarballPath("@kilocode/cli-test", "1.0.0")}`)
      }
      if (path === tarballPath("@kilocode/cli-test", "1.0.0")) {
        ranges.push(request.headers.get("range"))
        return new Response(new Uint8Array([0x1f, 0x8b, 0x08]))
      }
      return new Response("not found", { status: 404 })
    })

    await waitForRegistry([{ name: "@kilocode/cli-test", version: "1.0.0" }], { registry: server.url.origin })

    expect(paths).toEqual(["/@kilocode/cli-test", "/@kilocode/cli-test/-/cli-test-1.0.0.tgz"])
    expect(accepts).toEqual(["application/vnd.npm.install-v1+json"])
    expect(ranges).toEqual(["bytes=0-0"])
  })

  test("retries while the install document does not list the exact version", async () => {
    let documents = 0
    const paths: string[] = []
    const server = serve((request) => {
      const url = new URL(request.url)
      const path = decodeURIComponent(url.pathname)
      paths.push(path)
      if (path === "/@kilocode/cli-test") {
        documents++
        if (documents < 3)
          return document("@kilocode/cli-test", "0.9.0", `${url.origin}${tarballPath("@kilocode/cli-test", "0.9.0")}`)
        return document("@kilocode/cli-test", "1.0.0", `${url.origin}${tarballPath("@kilocode/cli-test", "1.0.0")}`)
      }
      if (path === tarballPath("@kilocode/cli-test", "1.0.0")) return new Response(new Uint8Array([0x1f]))
      return new Response("not found", { status: 404 })
    })

    await waitForRegistry([{ name: "@kilocode/cli-test", version: "1.0.0" }], {
      registry: server.url.origin,
      attempts: 5,
      delay: 1,
    })

    expect(documents).toBe(3)
    expect(paths).not.toContain("/@kilocode/cli-test/1.0.0")
  })

  test("fails after the bounded attempts while a tarball returns 404", async () => {
    let tarballs = 0
    const server = serve((request) => {
      const url = new URL(request.url)
      const path = decodeURIComponent(url.pathname)
      if (path === "/@kilocode/cli-test")
        return document("@kilocode/cli-test", "1.0.0", `${url.origin}${tarballPath("@kilocode/cli-test", "1.0.0")}`)
      if (path === tarballPath("@kilocode/cli-test", "1.0.0")) {
        tarballs++
        return new Response("missing", { status: 404 })
      }
      return new Response("not found", { status: 404 })
    })

    let message = ""
    await waitForRegistry([{ name: "@kilocode/cli-test", version: "1.0.0" }], {
      registry: server.url.origin,
      attempts: 2,
      delay: 1,
    }).catch((error: Error) => {
      message = error.message
    })

    expect(message).toContain("@kilocode/cli-test@1.0.0: tarball HTTP 404")
    expect(message).toContain("after 2 attempts")
    expect(tarballs).toBe(2)
  })

  test("cancels the tarball body after one chunk when the registry ignores Range", async () => {
    const chunk = new Uint8Array(64 * 1024)
    const total = 512
    let sent = 0
    const server = serve((request) => {
      const url = new URL(request.url)
      const path = decodeURIComponent(url.pathname)
      if (path === "/@kilocode/cli-test")
        return document("@kilocode/cli-test", "1.0.0", `${url.origin}${tarballPath("@kilocode/cli-test", "1.0.0")}`)
      if (path === tarballPath("@kilocode/cli-test", "1.0.0")) {
        let remaining = total
        return new Response(
          new ReadableStream({
            pull(controller) {
              if (remaining === 0) return controller.close()
              remaining--
              sent++
              controller.enqueue(chunk)
            },
          }),
          { headers: { "content-length": String(total * chunk.byteLength) } },
        )
      }
      return new Response("not found", { status: 404 })
    })

    await waitForRegistry([{ name: "@kilocode/cli-test", version: "1.0.0" }], { registry: server.url.origin })

    expect(sent).toBeLessThan(total)
  })

  test("rejects an install document for another package", async () => {
    const server = serve((request) => {
      const url = new URL(request.url)
      if (decodeURIComponent(url.pathname) === "/@kilocode/cli-test")
        return document("@kilocode/other", "1.0.0", `${url.origin}${tarballPath("@kilocode/cli-test", "1.0.0")}`)
      return new Response("not found", { status: 404 })
    })

    let message = ""
    await waitForRegistry([{ name: "@kilocode/cli-test", version: "1.0.0" }], {
      registry: server.url.origin,
      attempts: 1,
    }).catch((error: Error) => {
      message = error.message
    })

    expect(message).toContain("install document is for @kilocode/other")
  })

  test("rejects an install document whose entry names another package", async () => {
    const server = serve((request) => {
      const url = new URL(request.url)
      if (decodeURIComponent(url.pathname) === "/@kilocode/cli-test")
        return Response.json({
          name: "@kilocode/cli-test",
          versions: {
            "1.0.0": {
              name: "@kilocode/other",
              version: "1.0.0",
              dist: { tarball: `${url.origin}${tarballPath("@kilocode/cli-test", "1.0.0")}` },
            },
          },
        })
      return new Response("not found", { status: 404 })
    })

    let message = ""
    await waitForRegistry([{ name: "@kilocode/cli-test", version: "1.0.0" }], {
      registry: server.url.origin,
      attempts: 1,
    }).catch((error: Error) => {
      message = error.message
    })

    expect(message).toContain("install document entry is @kilocode/other@1.0.0")
  })

  test("fails when the install document points the tarball at another origin", async () => {
    let foreign = 0
    const other = serve(() => {
      foreign++
      return new Response(new Uint8Array([0x1f]))
    })
    const server = serve((request) => {
      const url = new URL(request.url)
      const path = decodeURIComponent(url.pathname)
      if (path === "/@kilocode/cli-test")
        return document(
          "@kilocode/cli-test",
          "1.0.0",
          `${other.url.origin}${tarballPath("@kilocode/cli-test", "1.0.0")}`,
        )
      return new Response("not found", { status: 404 })
    })

    let message = ""
    await waitForRegistry([{ name: "@kilocode/cli-test", version: "1.0.0" }], {
      registry: server.url.origin,
      attempts: 2,
      delay: 1,
    }).catch((error: Error) => {
      message = error.message
    })

    expect(message).toContain("install document tarball")
    expect(message).toContain("is not")
    expect(foreign).toBe(0)
  })

  test.each(["install document", "tarball"] as const)("forbids a redirected %s", async (target) => {
    const server = serve((request) => {
      const url = new URL(request.url)
      const path = decodeURIComponent(url.pathname)
      if (path === "/@kilocode/cli-test") {
        if (target === "install document") return Response.redirect(`${url.origin}/redirected`, 302)
        return document("@kilocode/cli-test", "1.0.0", `${url.origin}${tarballPath("@kilocode/cli-test", "1.0.0")}`)
      }
      if (path === tarballPath("@kilocode/cli-test", "1.0.0")) return Response.redirect(`${url.origin}/redirected`, 302)
      return new Response("not found", { status: 404 })
    })

    let message = ""
    await waitForRegistry([{ name: "@kilocode/cli-test", version: "1.0.0" }], {
      registry: server.url.origin,
      attempts: 1,
    }).catch((error: Error) => {
      message = error.message
    })

    expect(message).toMatch(/redirect/i)
  })
})

describe("taggedVersion", () => {
  test("reads the version behind the dist-tag", async () => {
    const paths: string[] = []
    const server = serve((request) => {
      const url = new URL(request.url)
      const path = decodeURIComponent(url.pathname)
      paths.push(path)
      if (path === "/@kilocode/cli-test/kilo-v2")
        return Response.json({ name: "@kilocode/cli-test", version: "0.0.0-v2-100.2" })
      return new Response("not found", { status: 404 })
    })

    await expect(taggedVersion("@kilocode/cli-test", "kilo-v2", { registry: server.url.origin })).resolves.toBe(
      "0.0.0-v2-100.2",
    )
    expect(paths).toEqual(["/@kilocode/cli-test/kilo-v2"])
  })

  test("returns nothing for a missing tag", async () => {
    const server = serve(() => new Response("not found", { status: 404 }))
    await expect(
      taggedVersion("@kilocode/cli-test", "kilo-v2", { registry: server.url.origin }),
    ).resolves.toBeUndefined()
  })

  test("forbids a redirected tag lookup", async () => {
    const server = serve((request) => Response.redirect(`${new URL(request.url).origin}/redirected`, 302))
    await expect(taggedVersion("@kilocode/cli-test", "kilo-v2", { registry: server.url.origin })).rejects.toThrow(
      /redirect/i,
    )
  })

  test("rejects a tag document for another package", async () => {
    const server = serve(() => Response.json({ name: "@kilocode/other", version: "0.0.0-v2-100" }))
    await expect(taggedVersion("@kilocode/cli-test", "kilo-v2", { registry: server.url.origin })).rejects.toThrow(
      "@kilocode/other",
    )
  })
})

describe("refuseStale", () => {
  test("refuses a version older than the tag", async () => {
    const server = serve(() => Response.json({ name: "@kilocode/cli-test", version: "0.0.0-v2-101" }))
    await expect(
      refuseStale("@kilocode/cli-test", "0.0.0-v2-100", "kilo-v2", { registry: server.url.origin }),
    ).rejects.toThrow("already points to 0.0.0-v2-101")
  })

  test("allows an equal version so a rerun can publish missing packages", async () => {
    const server = serve(() => Response.json({ name: "@kilocode/cli-test", version: "0.0.0-v2-100.2" }))
    await expect(
      refuseStale("@kilocode/cli-test", "0.0.0-v2-100.2", "kilo-v2", { registry: server.url.origin }),
    ).resolves.toBeUndefined()
  })

  test("allows a missing tag", async () => {
    const server = serve(() => new Response("not found", { status: 404 }))
    await expect(
      refuseStale("@kilocode/cli-test", "0.0.0-v2-100", "kilo-v2", { registry: server.url.origin }),
    ).resolves.toBeUndefined()
  })

  test("refuses a tag that is not a Kilo v2 preview", async () => {
    const server = serve(() => Response.json({ name: "@kilocode/cli-test", version: "7.8.27" }))
    await expect(
      refuseStale("@kilocode/cli-test", "0.0.0-v2-100", "kilo-v2", { registry: server.url.origin }),
    ).rejects.toThrow("already points to 7.8.27")
  })
})

describe("stale", () => {
  test("orders run numbers and attempts numerically", () => {
    expect(stale("0.0.0-v2-99", "0.0.0-v2-100")).toBe(true)
    expect(stale("0.0.0-v2-100", "0.0.0-v2-99")).toBe(false)
    expect(stale("0.0.0-v2-99.2", "0.0.0-v2-99.10")).toBe(true)
    expect(stale("0.0.0-v2-99.10", "0.0.0-v2-99.2")).toBe(false)
    expect(stale("0.0.0-v2-100", "0.0.0-v2-100")).toBe(false)
    expect(stale("0.0.0-v2-100.1", "0.0.0-v2-100")).toBe(false)
    expect(stale("0.0.0-v2-100", "0.0.0-v2-100.1")).toBe(false)
  })

  test("refuses a tag that is not a Kilo v2 preview", () => {
    expect(stale("0.0.0-v2-100", "7.8.27")).toBe(true)
    expect(stale("7.8.27", "0.0.0-v2-100")).toBe(true)
  })
})
