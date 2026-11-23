import { describe, expect, it } from "bun:test"
import { createKiloClient } from "@kilocode/sdk/v2/client"
import * as vscode from "vscode"
import { marketplaceBundles } from "../../src/services/marketplace/bundles"

const UUID_A = "11111111-1111-4111-8111-111111111111"
const UUID_B = "22222222-2222-4222-8222-222222222222"

const fs = vscode.workspace.fs as unknown as {
  readFile: (uri: vscode.Uri) => Promise<Uint8Array>
  stat: (uri: vscode.Uri) => Promise<{ type: number; size: number; ctime: number; mtime: number }>
}
const original = { readFile: fs.readFile, stat: fs.stat }

function setup(files: Map<string, string>) {
  fs.stat = async (uri) => {
    const body = files.get(uri.fsPath)
    if (body === undefined) throw new Error("ENOENT")
    return { type: vscode.FileType.File, size: Buffer.byteLength(body, "utf8"), ctime: 0, mtime: 0 }
  }
  fs.readFile = async (uri) => {
    const body = files.get(uri.fsPath)
    if (body === undefined) throw new Error("ENOENT")
    return Buffer.from(body)
  }
}

function restore() {
  fs.readFile = original.readFile
  fs.stat = original.stat
}

function serve(skills: Array<{ name: string; location: string; content: string }>) {
  return Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const url = new URL(request.url)
      if (url.pathname === "/skill") return Response.json(skills)
      return new Response(null, { status: 404 })
    },
  })
}

describe("marketplaceBundles", () => {
  it("reads catalog independent companion ownership markers for project and global scope", async () => {
    const projectSkill = "/repo/.kilo/skills/context7/SKILL.md"
    const globalSkill = "/home/user/.kilo/skills/context7/SKILL.md"
    const files = new Map([
      [
        "/repo/.kilo/skills/context7/.kilo-marketplace.json",
        JSON.stringify({ version: 1, id: "context7", token: UUID_A }),
      ],
      [
        "/home/user/.kilo/skills/context7/.kilo-marketplace.json",
        JSON.stringify({ version: 1, id: "context7", token: UUID_B }),
      ],
    ])
    setup(files)
    const server = serve([
      { name: "context7-project", location: projectSkill, content: "" },
      { name: "context7-global", location: globalSkill, content: "" },
    ])
    try {
      const client = createKiloClient({ baseUrl: server.url.href })
      const bundles = await marketplaceBundles(client, "/repo")
      expect(bundles).toEqual([
        { id: "context7", scope: "global", skills: [globalSkill] },
        { id: "context7", scope: "project", skills: [projectSkill] },
      ])
    } finally {
      restore()
      server.stop(true)
    }
  })

  it("rejects a marker file larger than 4 KiB", async () => {
    const skill = "/repo/.kilo/skills/context7/SKILL.md"
    const oversized = JSON.stringify({ version: 1, id: "context7", token: UUID_A, pad: "x".repeat(5000) })
    setup(new Map([["/repo/.kilo/skills/context7/.kilo-marketplace.json", oversized]]))
    const server = serve([{ name: "context7", location: skill, content: "" }])
    try {
      const client = createKiloClient({ baseUrl: server.url.href })
      expect(await marketplaceBundles(client, "/repo")).toEqual([])
    } finally {
      restore()
      server.stop(true)
    }
  })

  it("rejects an unsupported marker version", async () => {
    const skill = "/repo/.kilo/skills/context7/SKILL.md"
    setup(
      new Map([
        [
          "/repo/.kilo/skills/context7/.kilo-marketplace.json",
          JSON.stringify({ version: 2, id: "context7", token: UUID_A }),
        ],
      ]),
    )
    const server = serve([{ name: "context7", location: skill, content: "" }])
    try {
      const client = createKiloClient({ baseUrl: server.url.href })
      expect(await marketplaceBundles(client, "/repo")).toEqual([])
    } finally {
      restore()
      server.stop(true)
    }
  })

  it("rejects a non-UUID token", async () => {
    const skill = "/repo/.kilo/skills/context7/SKILL.md"
    setup(
      new Map([
        [
          "/repo/.kilo/skills/context7/.kilo-marketplace.json",
          JSON.stringify({ version: 1, id: "context7", token: "not-a-uuid" }),
        ],
      ]),
    )
    const server = serve([{ name: "context7", location: skill, content: "" }])
    try {
      const client = createKiloClient({ baseUrl: server.url.href })
      expect(await marketplaceBundles(client, "/repo")).toEqual([])
    } finally {
      restore()
      server.stop(true)
    }
  })

  it("rejects an unsafe id", async () => {
    const skill = "/repo/.kilo/skills/context7/SKILL.md"
    setup(
      new Map([
        [
          "/repo/.kilo/skills/context7/.kilo-marketplace.json",
          JSON.stringify({ version: 1, id: "../escape", token: UUID_A }),
        ],
      ]),
    )
    const server = serve([{ name: "context7", location: skill, content: "" }])
    try {
      const client = createKiloClient({ baseUrl: server.url.href })
      expect(await marketplaceBundles(client, "/repo")).toEqual([])
    } finally {
      restore()
      server.stop(true)
    }
  })

  it("skips builtin skills", async () => {
    const server = serve([{ name: "builtin-skill", location: "builtin", content: "" }])
    try {
      const client = createKiloClient({ baseUrl: server.url.href })
      expect(await marketplaceBundles(client, "/repo")).toEqual([])
    } finally {
      server.stop(true)
    }
  })

  it("groups multiple companion skills under the same bundle", async () => {
    const a = "/repo/.kilo/skills/query-workflow/SKILL.md"
    const b = "/repo/.kilo/skills/data-checks/SKILL.md"
    setup(
      new Map([
        [
          "/repo/.kilo/skills/query-workflow/.kilo-marketplace.json",
          JSON.stringify({ version: 1, id: "anaconda", token: UUID_A }),
        ],
        [
          "/repo/.kilo/skills/data-checks/.kilo-marketplace.json",
          JSON.stringify({ version: 1, id: "anaconda", token: UUID_A }),
        ],
      ]),
    )
    const server = serve([
      { name: "query-workflow", location: a, content: "" },
      { name: "data-checks", location: b, content: "" },
    ])
    try {
      const client = createKiloClient({ baseUrl: server.url.href })
      expect(await marketplaceBundles(client, "/repo")).toEqual([{ id: "anaconda", scope: "project", skills: [b, a] }])
    } finally {
      restore()
      server.stop(true)
    }
  })
})
