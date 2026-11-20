import { afterEach, describe, expect, test } from "bun:test"
import {
  previewVersions,
  refuseStale,
  refuseWithdrawn,
  stale,
  taggedVersion,
  waitForRegistry,
  withdrawn,
} from "../script/registry-readiness"

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

function history(name: string, versions: string[], origin: string) {
  return Response.json({
    name,
    versions: Object.fromEntries(
      versions.map((version) => [
        version,
        { name, version, dist: { tarball: `${origin}${tarballPath(name, version)}` } },
      ]),
    ),
  })
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

  test("retries only the packages that are still pending", async () => {
    const documents = new Map<string, number>()
    const tarballs = new Map<string, number>()
    const server = serve((request) => {
      const url = new URL(request.url)
      const path = decodeURIComponent(url.pathname)
      if (path === "/@kilocode/cli-ready") {
        documents.set("ready", (documents.get("ready") ?? 0) + 1)
        return document("@kilocode/cli-ready", "1.0.0", `${url.origin}${tarballPath("@kilocode/cli-ready", "1.0.0")}`)
      }
      if (path === tarballPath("@kilocode/cli-ready", "1.0.0")) {
        tarballs.set("ready", (tarballs.get("ready") ?? 0) + 1)
        return new Response(new Uint8Array([0x1f]))
      }
      if (path === "/@kilocode/cli-slow") {
        const count = (documents.get("slow") ?? 0) + 1
        documents.set("slow", count)
        if (count < 3)
          return document("@kilocode/cli-slow", "0.9.0", `${url.origin}${tarballPath("@kilocode/cli-slow", "0.9.0")}`)
        return document("@kilocode/cli-slow", "1.0.0", `${url.origin}${tarballPath("@kilocode/cli-slow", "1.0.0")}`)
      }
      if (path === tarballPath("@kilocode/cli-slow", "1.0.0")) {
        tarballs.set("slow", (tarballs.get("slow") ?? 0) + 1)
        return new Response(new Uint8Array([0x1f]))
      }
      return new Response("not found", { status: 404 })
    })

    await waitForRegistry(
      [
        { name: "@kilocode/cli-ready", version: "1.0.0" },
        { name: "@kilocode/cli-slow", version: "1.0.0" },
      ],
      { registry: server.url.origin, attempts: 5, delay: 1 },
    )

    expect(documents.get("ready")).toBe(1)
    expect(tarballs.get("ready")).toBe(1)
    expect(documents.get("slow")).toBe(3)
    expect(tarballs.get("slow")).toBe(1)
  })

  test("stops probing a ready package while a pending one exhausts the bounded attempts", async () => {
    let ready = 0
    let pending = 0
    const server = serve((request) => {
      const url = new URL(request.url)
      const path = decodeURIComponent(url.pathname)
      if (path === "/@kilocode/cli-ready") {
        ready++
        return document("@kilocode/cli-ready", "1.0.0", `${url.origin}${tarballPath("@kilocode/cli-ready", "1.0.0")}`)
      }
      if (path === tarballPath("@kilocode/cli-ready", "1.0.0")) return new Response(new Uint8Array([0x1f]))
      if (path === "/@kilocode/cli-pending") {
        pending++
        return document(
          "@kilocode/cli-pending",
          "0.9.0",
          `${url.origin}${tarballPath("@kilocode/cli-pending", "0.9.0")}`,
        )
      }
      return new Response("not found", { status: 404 })
    })

    let message = ""
    await waitForRegistry(
      [
        { name: "@kilocode/cli-ready", version: "1.0.0" },
        { name: "@kilocode/cli-pending", version: "1.0.0" },
      ],
      { registry: server.url.origin, attempts: 3, delay: 1 },
    ).catch((error: Error) => {
      message = error.message
    })

    expect(message).toContain("after 3 attempts")
    expect(message).toContain("@kilocode/cli-pending@1.0.0: install document has no 1.0.0")
    expect(message).not.toContain("@kilocode/cli-ready")
    expect(ready).toBe(1)
    expect(pending).toBe(3)
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

describe("previewVersions", () => {
  test("reads preview versions from the install document without reading a tag", async () => {
    const paths: string[] = []
    const server = serve((request) => {
      const url = new URL(request.url)
      const path = decodeURIComponent(url.pathname)
      paths.push(path)
      if (path === "/@kilocode/cli-test")
        return history("@kilocode/cli-test", ["7.8.27", "0.0.0-v2-99", "0.0.0-v2-100.2"], url.origin)
      return new Response("not found", { status: 404 })
    })

    await expect(previewVersions("@kilocode/cli-test", { registry: server.url.origin })).resolves.toEqual([
      "0.0.0-v2-99",
      "0.0.0-v2-100.2",
    ])
    expect(paths).toEqual(["/@kilocode/cli-test"])
  })

  test("does not mistake a missing launcher document for empty preview history", async () => {
    const server = serve(() => new Response("not found", { status: 404 }))
    await expect(previewVersions("@kilocode/cli-test", { registry: server.url.origin })).rejects.toThrow(
      "install document HTTP 404",
    )
  })

  test("permits the first preview when the launcher only has stable history", async () => {
    const server = serve((request) => history("@kilocode/cli-test", ["7.8.27"], new URL(request.url).origin))
    await expect(
      refuseWithdrawn("@kilocode/cli-test", "0.0.0-v2-1", { registry: server.url.origin }),
    ).resolves.toBeUndefined()
  })

  test("rejects another package document", async () => {
    const server = serve((request) => {
      const url = new URL(request.url)
      if (decodeURIComponent(url.pathname) === "/@kilocode/cli-test")
        return history("@kilocode/other", ["0.0.0-v2-100"], url.origin)
      return new Response("not found", { status: 404 })
    })
    await expect(previewVersions("@kilocode/cli-test", { registry: server.url.origin })).rejects.toThrow(
      "@kilocode/other",
    )
  })

  test("rejects a document without a version history", async () => {
    const server = serve((request) => {
      const url = new URL(request.url)
      if (decodeURIComponent(url.pathname) === "/@kilocode/cli-test")
        return Response.json({ name: "@kilocode/cli-test" })
      return new Response("not found", { status: 404 })
    })
    await expect(previewVersions("@kilocode/cli-test", { registry: server.url.origin })).rejects.toThrow(
      "no version history",
    )
  })

  test("forbids a redirected history lookup", async () => {
    const server = serve((request) => Response.redirect(`${new URL(request.url).origin}/redirected`, 302))
    await expect(previewVersions("@kilocode/cli-test", { registry: server.url.origin })).rejects.toThrow(/redirect/i)
  })
})

describe("refuseWithdrawn", () => {
  test("refuses a rerun of an already published run after a tag rollback", async () => {
    const paths: string[] = []
    const server = serve((request) => {
      const url = new URL(request.url)
      const path = decodeURIComponent(url.pathname)
      paths.push(path)
      if (path === "/@kilocode/cli-test")
        return history("@kilocode/cli-test", ["0.0.0-v2-90", "0.0.0-v2-100"], url.origin)
      if (path === "/@kilocode/cli-test/kilo-v2")
        return Response.json({ name: "@kilocode/cli-test", version: "0.0.0-v2-90" })
      return new Response("not found", { status: 404 })
    })

    let message = ""
    await refuseWithdrawn("@kilocode/cli-test", "0.0.0-v2-100.2", { registry: server.url.origin }).catch(
      (error: Error) => {
        message = error.message
      },
    )

    expect(message).toContain("already published @kilocode/cli-test@0.0.0-v2-100")
    expect(message).toContain("manual rollback")
    expect(paths).toEqual(["/@kilocode/cli-test"])
  })

  test("allows a genuinely new run after a rollback", async () => {
    const server = serve((request) => {
      const url = new URL(request.url)
      if (decodeURIComponent(url.pathname) === "/@kilocode/cli-test")
        return history("@kilocode/cli-test", ["0.0.0-v2-90", "0.0.0-v2-100"], url.origin)
      return new Response("not found", { status: 404 })
    })
    await expect(
      refuseWithdrawn("@kilocode/cli-test", "0.0.0-v2-101", { registry: server.url.origin }),
    ).resolves.toBeUndefined()
  })

  test("allows a retry when the launcher for that run was never published", async () => {
    // The first attempt published some platform packages but failed before the launcher. Only the launcher history
    // decides, so a later attempt of the same run can continue even if a platform tag still points at it.
    const server = serve((request) => {
      const url = new URL(request.url)
      const path = decodeURIComponent(url.pathname)
      if (path === "/@kilocode/cli-test")
        return history("@kilocode/cli-test", ["0.0.0-v2-90", "0.0.0-v2-99.3"], url.origin)
      if (path === "/@kilocode/cli-test/kilo-v2")
        return Response.json({ name: "@kilocode/cli-test", version: "0.0.0-v2-100" })
      return new Response("not found", { status: 404 })
    })
    await expect(
      refuseWithdrawn("@kilocode/cli-test", "0.0.0-v2-100.2", { registry: server.url.origin }),
    ).resolves.toBeUndefined()
  })

  test("fails closed when the launcher history cannot be read", async () => {
    const server = serve(() => new Response("error", { status: 500 }))
    await expect(
      refuseWithdrawn("@kilocode/cli-test", "0.0.0-v2-101", { registry: server.url.origin }),
    ).rejects.toThrow("install document HTTP 500")
  })

  test("refuses a build that is not a Kilo v2 preview", async () => {
    await expect(refuseWithdrawn("@kilocode/cli-test", "7.8.27")).rejects.toThrow("not a Kilo v2 preview")
  })
})

describe("withdrawn", () => {
  test("rejects every attempt of a published run", () => {
    expect(withdrawn("0.0.0-v2-100.2", ["0.0.0-v2-100"])).toBe("0.0.0-v2-100")
    expect(withdrawn("0.0.0-v2-100", ["0.0.0-v2-100.2"])).toBe("0.0.0-v2-100.2")
    expect(withdrawn("0.0.0-v2-100.3", ["0.0.0-v2-100.10"])).toBe("0.0.0-v2-100.10")
  })

  test("allows a run that is newer than every published preview", () => {
    expect(withdrawn("0.0.0-v2-101", ["0.0.0-v2-99", "0.0.0-v2-100.10"])).toBeUndefined()
    expect(withdrawn("0.0.0-v2-100", ["0.0.0-v2-99.10"])).toBeUndefined()
    expect(withdrawn("0.0.0-v2-100.2", [])).toBeUndefined()
  })

  test("ignores non-preview versions from the same package", () => {
    expect(withdrawn("0.0.0-v2-100", ["7.8.27", "7.8.30", "0.0.0-v2-99"])).toBeUndefined()
  })

  test("rejects a run older than the published high-water mark", () => {
    expect(withdrawn("0.0.0-v2-99", ["0.0.0-v2-100"])).toBe("0.0.0-v2-100")
    expect(withdrawn("0.0.0-v2-99.10", ["0.0.0-v2-100"])).toBe("0.0.0-v2-100")
  })

  test("fails closed for a build that is not a Kilo v2 preview", () => {
    expect(withdrawn("7.8.27", ["0.0.0-v2-100"])).toBe("7.8.27")
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
