import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Installer } from "../src/marketplace/installer"
import { McpRegistry } from "../src/marketplace/mcp-registry"
import { build, parameters, serverName } from "../src/marketplace/mcp"
import { extract } from "../src/marketplace/skill"
import { SkillsShRegistry } from "../src/marketplace/skills-sh"

describe("skills.sh registry", () => {
  test("keeps GitHub-backed skills, ids them by repository and installs from the repository tarball", () => {
    const entries = SkillsShRegistry.parse({
      skills: [
        { source: "anthropics/skills", skillId: "pdf", name: "pdf", installs: 214316, isOfficial: true },
        { source: "anthropics/skills", skillId: "pdf", name: "pdf" },
        { source: "open.feishu.cn", skillId: "lark", name: "lark" },
        { broken: true },
      ],
    })
    expect(entries).toHaveLength(1)
    expect(entries[0].item).toMatchObject({
      registry: "skills.sh",
      kind: "skill",
      id: "anthropics/skills/pdf",
      name: "pdf",
      description: "anthropics/skills · 214K installs · official",
    })
    expect(entries[0].archive).toBe("https://codeload.github.com/anthropics/skills/tar.gz/HEAD")
    expect(entries[0].select).toBe("pdf")
  })

  test("selects one skill from a repository archive", async () => {
    const archive = await new Bun.Archive(
      {
        "skills-HEAD/README.md": "repo",
        "skills-HEAD/skills/pdf/SKILL.md": "---\nname: pdf\n---",
        "skills-HEAD/skills/pdf/scripts/run.py": "print()",
        "skills-HEAD/skills/docx/SKILL.md": "---\nname: docx\n---",
        "skills-HEAD/vendor/deep/pdf/SKILL.md": "a deeper copy",
      },
      { compress: "gzip" },
    ).bytes()
    const files = await extract(archive, "pdf")
    expect(files.map((file) => file.path).toSorted()).toEqual(["SKILL.md", "scripts/run.py"])
    await expect(extract(archive, "missing")).rejects.toThrow(/no skill named missing/)
  })

  test("lists and searches the directory over HTTP", async () => {
    const requests: string[] = []
    const fixture = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        const url = new URL(request.url)
        requests.push(url.pathname + url.search)
        return Response.json({ skills: [{ source: "example/skills", skillId: "pdf" }] })
      },
    })
    try {
      const registry = SkillsShRegistry.make({ base: fixture.url.origin })
      expect((await registry.list("skill")).map((entry) => entry.item.id)).toEqual(["example/skills/pdf"])
      expect((await registry.list("skill", " pdf guide ")).map((entry) => entry.item.id)).toEqual([
        "example/skills/pdf",
      ])
      expect(await registry.list("mcp")).toEqual([])
      expect(requests).toEqual(["/api/skills/all-time/0", "/api/search?q=pdf%20guide&limit=100"])
    } finally {
      await fixture.stop(true)
    }
  })
})

describe("MCP registry", () => {
  const server = (value: Record<string, unknown>) => ({ servers: [{ server: { name: "io.example/demo", ...value } }] })

  test("turns remotes into options with header and URL variables as parameters", () => {
    const [entry] = McpRegistry.parse(
      server({
        title: "Demo",
        description: "Demo server",
        remotes: [
          {
            type: "streamable-http",
            url: "https://{tenant}.example.com/mcp",
            variables: { tenant: { isRequired: true, placeholder: "Your tenant" } },
            headers: [
              {
                name: "Authorization",
                value: "Bearer {api_key}",
                variables: { api_key: { isRequired: true, isSecret: true } },
              },
              { name: "X-Team", description: "Team id" },
            ],
          },
          { type: "websocket", url: "wss://ignored" },
        ],
      }),
    )
    expect(entry.item).toMatchObject({ registry: "mcp-registry", id: "io.example/demo", name: "Demo" })
    expect(entry.item.options.map((option) => option.name)).toEqual(["Remote (streamable-http)"])
    const option = entry.item.options[0]
    expect(option.parameters.map((parameter) => [parameter.key, parameter.optional])).toEqual([
      ["tenant", false],
      ["api_key", false],
      ["X_Team", true],
    ])
    expect(option.parameters[0].placeholder).toBe("Your tenant")
    expect(() =>
      build({ template: String(entry.payloads[0]), parameters: option.parameters, params: { api_key: "k" } }),
    ).toThrow("Missing required parameters: tenant")
    expect(
      build({
        template: String(entry.payloads[0]),
        parameters: parameters(entry.item, option),
        params: { tenant: "acme", api_key: "k" },
      }),
    ).toEqual({ type: "remote", url: "https://acme.example.com/mcp", headers: { Authorization: "Bearer k" } })
  })

  test("turns npm, PyPI and OCI packages into local commands", () => {
    const [entry] = McpRegistry.parse(
      server({
        packages: [
          {
            registryType: "npm",
            identifier: "@demo/server",
            version: "1.2.3",
            transport: { type: "stdio" },
            packageArguments: [
              { type: "named", name: "--mode", value: "read" },
              { type: "positional", valueHint: "dir", isRequired: true },
            ],
            environmentVariables: [{ name: "DEMO_KEY", isRequired: true, isSecret: true }],
          },
          { registryType: "pypi", identifier: "demo-server", version: "0.1.0" },
          {
            registryType: "oci",
            identifier: "ghcr.io/demo/server",
            version: "2",
            environmentVariables: [{ name: "TOKEN" }],
          },
          { registryType: "nuget", identifier: "Demo.Server" },
          { registryType: "npm", identifier: "http-only", transport: { type: "streamable-http" } },
        ],
      }),
    )
    expect(entry.item.options.map((option) => option.name)).toEqual(["npx (npm)", "uvx (pypi)", "docker (oci)"])
    const [npm, pypi, oci] = entry.item.options.map((option, index) =>
      build({
        template: String(entry.payloads[index]),
        parameters: parameters(entry.item, option),
        params: { DEMO_KEY: "k", dir: "/repo" },
      }),
    )
    expect(npm).toEqual({
      type: "local",
      command: ["npx", "-y", "@demo/server@1.2.3", "--mode", "read", "/repo"],
      environment: { DEMO_KEY: "k" },
    })
    expect(pypi).toEqual({ type: "local", command: ["uvx", "demo-server==0.1.0"] })
    expect(oci).toEqual({
      type: "local",
      command: ["docker", "run", "-i", "--rm", "-e", "TOKEN", "ghcr.io/demo/server:2"],
    })
  })

  test("drops servers without a runnable option and names config keys safely", () => {
    expect(McpRegistry.parse(server({ packages: [{ registryType: "nuget", identifier: "x" }] }))).toEqual([])
    expect(serverName("io.github.owner/server-name")).toBe("io-github-owner-server-name")
    expect(serverName("context7")).toBe("context7")
  })

  test("preserves fixed values and defaults and resolves only declared nested inputs", () => {
    const [entry] = McpRegistry.parse(
      server({
        remotes: [
          {
            type: "streamable-http",
            url: "https://{tenant}.example.com/{path}",
            variables: { tenant: { default: "demo", isRequired: true }, path: { value: "mcp" } },
            headers: [
              { name: "X-Fixed", value: "{literal}" },
              { name: "X-Empty", value: "" },
              { name: "X-Default", default: "production", isRequired: true },
              { name: "Authorization", value: "Bearer {token}", variables: { token: { isRequired: true } } },
            ],
          },
        ],
        packages: [
          {
            registryType: "npm",
            identifier: "demo",
            environmentVariables: [
              { name: "MODE", value: "production" },
              { name: "REGION", default: "eu", isRequired: true },
              {
                name: "ENDPOINT",
                value: "https://{tenant}.example.com/{fixed}",
                variables: {
                  tenant: { isRequired: true, description: "Tenant name" },
                  fixed: { value: "api" },
                },
              },
            ],
            runtimeArguments: [
              {
                type: "named",
                name: "--registry",
                value: "https://{host}",
                variables: {
                  host: { default: "registry.example.com", isRequired: true },
                },
              },
            ],
            packageArguments: [
              { type: "named", name: "--mode", default: "read", isRequired: true },
              { type: "positional", value: "{root}/data", variables: { root: { isRequired: true } } },
              { type: "named", name: "--optional" },
            ],
          },
        ],
      }),
    )
    expect(entry.item.options[0].parameters.map((parameter) => parameter.key)).toEqual(["token"])
    expect(
      build({
        template: String(entry.payloads[0]),
        parameters: entry.item.options[0].parameters,
        params: { token: "k" },
      }),
    ).toEqual({
      type: "remote",
      url: "https://demo.example.com/mcp",
      headers: {
        "X-Fixed": "{literal}",
        "X-Default": "production",
        Authorization: "Bearer k",
      },
    })
    expect(entry.item.options[1].parameters).toEqual([
      { key: "tenant", name: "tenant", optional: false, placeholder: "Tenant name" },
      { key: "root", name: "root", optional: false, placeholder: undefined },
    ])
    expect(
      build({
        template: String(entry.payloads[1]),
        parameters: entry.item.options[1].parameters,
        params: { tenant: "acme", root: "/repo" },
      }),
    ).toEqual({
      type: "local",
      command: ["npx", "--registry", "https://registry.example.com", "-y", "demo", "--mode", "read", "/repo/data"],
      environment: {
        MODE: "production",
        REGION: "eu",
        ENDPOINT: "https://acme.example.com/api",
      },
    })
  })

  test("places Docker runtime options after run and before the image and package arguments", () => {
    const [entry] = McpRegistry.parse(
      server({
        packages: [
          {
            registryType: "oci",
            identifier: "ghcr.io/example/server",
            version: "1",
            runtimeArguments: [{ type: "named", name: "--network", value: "host" }],
            packageArguments: [{ type: "named", name: "--mode", value: "read" }],
            environmentVariables: [{ name: "MODE", value: "production" }],
          },
        ],
      }),
    )
    expect(
      build({ template: String(entry.payloads[0]), parameters: entry.item.options[0].parameters, params: {} }),
    ).toEqual({
      type: "local",
      command: [
        "docker",
        "run",
        "--network",
        "host",
        "-i",
        "--rm",
        "-e",
        "MODE",
        "ghcr.io/example/server:1",
        "--mode",
        "read",
      ],
      environment: { MODE: "production" },
    })
  })

  test("installs the selected later remote and package variants by their unique option names", async () => {
    const [entry] = McpRegistry.parse(
      server({
        remotes: [
          { type: "streamable-http", url: "https://first.example.com/mcp" },
          { type: "streamable-http", url: "https://second.example.com/mcp" },
        ],
        packages: [
          { registryType: "npm", identifier: "first-server" },
          { registryType: "npm", identifier: "second-server" },
        ],
      }),
    )
    expect(new Set(entry.item.options.map((option) => option.name)).size).toBe(4)
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-registry-"))
    try {
      for (const index of [1, 3]) {
        const config = path.join(root, `config-${index}.json`)
        await Installer.install({
          entry,
          option: entry.item.options[index].name,
          config,
          skills: path.join(root, "skills"),
        })
        expect((await Bun.file(config).json()).mcp.servers["io-example-demo"]).toEqual(
          index === 1
            ? { type: "remote", url: "https://second.example.com/mcp" }
            : { type: "local", command: ["npx", "-y", "second-server"] },
        )
      }
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  test("lists and searches the registry over HTTP", async () => {
    const requests: string[] = []
    const fixture = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        const url = new URL(request.url)
        requests.push(url.pathname + url.search)
        return Response.json(server({ remotes: [{ type: "sse", url: "https://example.com/sse" }] }))
      },
    })
    try {
      const registry = McpRegistry.make({ base: fixture.url.origin })
      expect((await registry.list("mcp")).map((entry) => entry.item.id)).toEqual(["io.example/demo"])
      expect((await registry.list("mcp", " demo server ")).map((entry) => entry.item.id)).toEqual(["io.example/demo"])
      expect(await registry.list("skill")).toEqual([])
      expect(requests).toEqual([
        "/v0/servers?version=latest&limit=100",
        "/v0/servers?version=latest&limit=30&search=demo%20server",
      ])
    } finally {
      await fixture.stop(true)
    }
  })
})
