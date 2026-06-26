import { createHash } from "node:crypto"
import { gzipSync } from "node:zlib"

export function manifest() {
  return {
    version: 1,
    revision: "2026-06-22.1",
    items: [
      {
        kind: "mcp",
        id: "example-mcp",
        version: "1.2.3",
        source_revision: "a".repeat(40),
        name: "Example MCP",
        description: "A fixture MCP server",
        publisher: {
          id: "kilo",
          name: "Kilo",
          trust: "first-party",
          url: "https://kilo.ai",
        },
        maturity: "stable",
        support: "kilo",
        source_url: "https://github.com/Kilo-Org/example",
        installability: { installable: true },
        tags: ["data"],
        methods: [
          {
            id: "remote-http",
            name: "Remote HTTP",
            template: {
              type: "remote",
              url: "https://mcp.example.com/{param:workspace}",
              headers: { Authorization: "Bearer {env:MCP_TOKEN}" },
              enabled: false,
            },
            parameters: [
              {
                id: "workspace",
                name: "Workspace",
                type: "string",
                required: true,
                sensitive: false,
              },
              {
                id: "token",
                name: "Token",
                type: "string",
                required: true,
                sensitive: true,
                environment: "MCP_TOKEN",
              },
            ],
            prerequisites: [],
            platforms: ["darwin", "linux", "win32"],
            auth: { mode: "environment", environment: ["MCP_TOKEN"] },
            warnings: { writes: false },
          },
        ],
      },
    ],
  }
}

export function localManifest() {
  const value = manifest()
  const item = value.items[0]
  const method = item.methods[0]
  return {
    ...value,
    items: [
      {
        ...item,
        methods: [
          {
            ...method,
            id: "local-npx",
            name: "Local npx",
            template: {
              type: "local",
              command: ["npx", "-y", "example-mcp", "--workspace", "{param:workspace}"],
              environment: { MCP_TOKEN: "{env:MCP_TOKEN}" },
              enabled: false,
            },
          },
        ],
      },
    ],
  }
}

export interface TarEntry {
  readonly name: string
  readonly content?: string | Uint8Array
  readonly type?: "0" | "2" | "5"
  readonly link?: string
}

function field(header: Uint8Array, offset: number, length: number, value: string) {
  header.set(Buffer.from(value).subarray(0, length), offset)
}

function octal(header: Uint8Array, offset: number, length: number, value: number) {
  field(header, offset, length, `${value.toString(8).padStart(length - 1, "0")}\0`)
}

export function archive(entries: ReadonlyArray<TarEntry>) {
  const chunks: Uint8Array[] = []
  for (const entry of entries) {
    const data =
      typeof entry.content === "string"
        ? Buffer.from(entry.content)
        : entry.content
          ? Buffer.from(entry.content)
          : Buffer.alloc(0)
    const header = Buffer.alloc(512)
    field(header, 0, 100, entry.name)
    octal(header, 100, 8, entry.type === "5" ? 0o755 : 0o644)
    octal(header, 108, 8, 0)
    octal(header, 116, 8, 0)
    octal(header, 124, 12, data.byteLength)
    octal(header, 136, 12, 0)
    field(header, 148, 8, "        ")
    field(header, 156, 1, entry.type ?? "0")
    if (entry.link) field(header, 157, 100, entry.link)
    field(header, 257, 6, "ustar\0")
    field(header, 263, 2, "00")
    const sum = header.reduce((total, value) => total + value, 0)
    field(header, 148, 8, `${sum.toString(8).padStart(6, "0")}\0 `)
    chunks.push(header, data)
    const padding = (512 - (data.byteLength % 512)) % 512
    if (padding) chunks.push(Buffer.alloc(padding))
  }
  chunks.push(Buffer.alloc(1_024))
  return gzipSync(Buffer.concat(chunks))
}

export function skillArchive(id = "demo-skill") {
  return archive([
    {
      name: "SKILL.md",
      content: `---\nname: ${id}\ndescription: Test skill\n---\n\nUse this fixture skill.\n`,
    },
    { name: "references", type: "5" },
    { name: "references/example.txt", content: "reference" },
  ])
}

export function skillManifest(bytes: Uint8Array, url = "https://downloads.kilo.ai/skills/demo-skill.tar.gz") {
  return {
    version: 1,
    revision: "2026-06-22.2",
    items: [
      {
        kind: "skill",
        id: "demo-skill",
        version: "1.0.0",
        source_revision: "b".repeat(40),
        name: "Demo Skill",
        description: "A fixture Skill",
        publisher: { id: "kilo", name: "Kilo", trust: "first-party" },
        maturity: "stable",
        support: "kilo",
        source_url: "https://github.com/Kilo-Org/example-skill",
        installability: { installable: true },
        tags: ["data"],
        artifact: {
          url,
          digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
          size: bytes.byteLength,
          format: "tar.gz",
        },
      },
    ],
  }
}
