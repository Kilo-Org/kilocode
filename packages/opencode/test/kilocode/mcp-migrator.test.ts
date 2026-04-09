import { test, expect, describe } from "bun:test"
import { McpMigrator } from "../../src/kilocode/mcp-migrator"
import { tmpdir } from "../fixture/fixture"
import path from "path"

describe("McpMigrator", () => {
  describe("convertServer", () => {
    test("converts local server with command and args", () => {
      const server: McpMigrator.KilocodeMcpServer = {
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-filesystem"],
        env: { NODE_ENV: "production" },
      }

      const result = McpMigrator.convertServer("filesystem", server)

      expect(result).toEqual({
        type: "local",
        command: ["npx", "-y", "@modelcontextprotocol/server-filesystem"],
        environment: { NODE_ENV: "production" },
      })
    })

    test("converts server with command only (no args)", () => {
      const server: McpMigrator.KilocodeMcpServer = {
        command: "my-mcp-server",
      }

      const result = McpMigrator.convertServer("simple", server)

      expect(result).toEqual({
        type: "local",
        command: ["my-mcp-server"],
      })
    })

    test("converts disabled servers with enabled: false", () => {
      const server: McpMigrator.KilocodeMcpServer = {
        command: "npx",
        args: ["-y", "some-package"],
        disabled: true,
      }

      const result = McpMigrator.convertServer("disabled-server", server)

      expect(result).toEqual({
        type: "local",
        command: ["npx", "-y", "some-package"],
        enabled: false,
      })
    })

    test("omits environment when env is empty object", () => {
      const server: McpMigrator.KilocodeMcpServer = {
        command: "npx",
        env: {},
      }

      const result = McpMigrator.convertServer("test", server)

      expect(result).toEqual({
        type: "local",
        command: ["npx"],
      })
      expect(result).not.toHaveProperty("environment")
    })

    test("omits environment when env is undefined", () => {
      const server: McpMigrator.KilocodeMcpServer = {
        command: "npx",
      }

      const result = McpMigrator.convertServer("test", server)

      expect(result).not.toHaveProperty("environment")
    })

    test("preserves multiple environment variables", () => {
      const server: McpMigrator.KilocodeMcpServer = {
        command: "node",
        args: ["server.js"],
        env: {
          API_KEY: "secret123",
          DEBUG: "true",
          PORT: "3000",
        },
      }

      const result = McpMigrator.convertServer("multi-env", server)

      expect(result?.type).toBe("local")
      if (result?.type === "local") {
        expect(result.environment).toEqual({
          API_KEY: "secret123",
          DEBUG: "true",
          PORT: "3000",
        })
      }
    })
  })

  describe("readMcpSettings", () => {
    test("returns null for non-existent file", async () => {
      const result = await McpMigrator.readMcpSettings("/non/existent/path/mcp_settings.json")
      expect(result).toBeNull()
    })

    test("reads and parses valid JSON file", async () => {
      await using tmp = await tmpdir({
        init: async (dir) => {
          await Bun.write(
            path.join(dir, "mcp_settings.json"),
            JSON.stringify({
              mcpServers: {
                filesystem: {
                  command: "npx",
                  args: ["-y", "@modelcontextprotocol/server-filesystem"],
                },
              },
            }),
          )
        },
      })

      const result = await McpMigrator.readMcpSettings(path.join(tmp.path, "mcp_settings.json"))

      expect(result).not.toBeNull()
      expect(result?.mcpServers.filesystem.command).toBe("npx")
      expect(result?.mcpServers.filesystem.args).toEqual(["-y", "@modelcontextprotocol/server-filesystem"])
    })

    test("returns null for malformed JSON file instead of throwing", async () => {
      await using tmp = await tmpdir({
        init: async (dir) => {
          await Bun.write(path.join(dir, "mcp_settings.json"), "{ not valid json !!!")
        },
      })

      const result = await McpMigrator.readMcpSettings(path.join(tmp.path, "mcp_settings.json"))

      expect(result).toBeNull()
    })

    test("reads file with multiple servers", async () => {
      await using tmp = await tmpdir({
        init: async (dir) => {
          await Bun.write(
            path.join(dir, "mcp_settings.json"),
            JSON.stringify({
              mcpServers: {
                server1: { command: "cmd1" },
                server2: { command: "cmd2", args: ["--flag"] },
                server3: { command: "cmd3", disabled: true },
              },
            }),
          )
        },
      })

      const result = await McpMigrator.readMcpSettings(path.join(tmp.path, "mcp_settings.json"))

      expect(Object.keys(result?.mcpServers ?? {})).toHaveLength(3)
    })
  })

  describe("migrate", () => {
    test("returns empty result when no settings exist", async () => {
      await using tmp = await tmpdir()

      const result = await McpMigrator.migrate({
        projectDir: tmp.path,
        skipGlobalPaths: true,
      })

      expect(Object.keys(result.mcp)).toHaveLength(0)
      expect(result.warnings).toHaveLength(0)
      expect(result.skipped).toHaveLength(0)
    })

    test("migrates servers from project .kilo/mcp.json", async () => {
      await using tmp = await tmpdir({
        init: async (dir) => {
          const settingsDir = path.join(dir, ".kilo")
          await Bun.write(
            path.join(settingsDir, "mcp.json"),
            JSON.stringify({
              mcpServers: {
                filesystem: {
                  command: "npx",
                  args: ["-y", "@modelcontextprotocol/server-filesystem", "/home"],
                },
              },
            }),
          )
        },
      })

      const result = await McpMigrator.migrate({
        projectDir: tmp.path,
        skipGlobalPaths: true,
      })

      expect(result.mcp).toHaveProperty("filesystem")
      expect(result.mcp.filesystem).toEqual({
        type: "local",
        command: ["npx", "-y", "@modelcontextprotocol/server-filesystem", "/home"],
      })
    })

    test("reads from legacy .kilocode/mcp.json when .kilo/mcp.json is absent", async () => {
      await using tmp = await tmpdir({
        init: async (dir) => {
          const settingsDir = path.join(dir, ".kilocode")
          await Bun.write(
            path.join(settingsDir, "mcp.json"),
            JSON.stringify({
              mcpServers: {
                legacy: {
                  command: "node",
                  args: ["legacy-server.js"],
                },
              },
            }),
          )
        },
      })

      const result = await McpMigrator.migrate({
        projectDir: tmp.path,
        skipGlobalPaths: true,
      })

      expect(result.mcp).toHaveProperty("legacy")
      expect(result.mcp.legacy).toEqual({
        type: "local",
        command: ["node", "legacy-server.js"],
      })
    })

    // Regression: malformed .kilocode/mcp.json must not prevent .kilo/mcp.json from loading
    test("loads .kilo/mcp.json even when .kilocode/mcp.json is malformed", async () => {
      await using tmp = await tmpdir({
        init: async (dir) => {
          await Bun.write(path.join(dir, ".kilocode", "mcp.json"), "{ corrupt json !!!")
          await Bun.write(
            path.join(dir, ".kilo", "mcp.json"),
            JSON.stringify({
              mcpServers: {
                valid: { command: "valid-cmd", args: ["--ok"] },
              },
            }),
          )
        },
      })

      const result = await McpMigrator.migrate({
        projectDir: tmp.path,
        skipGlobalPaths: true,
      })

      expect(result.mcp).toHaveProperty("valid")
      expect(result.mcp.valid).toEqual({
        type: "local",
        command: ["valid-cmd", "--ok"],
      })
    })

    test(".kilo/mcp.json overrides .kilocode/mcp.json for same server name", async () => {
      await using tmp = await tmpdir({
        init: async (dir) => {
          await Bun.write(
            path.join(dir, ".kilocode", "mcp.json"),
            JSON.stringify({
              mcpServers: {
                myserver: { command: "old-cmd", args: ["old"] },
              },
            }),
          )
          await Bun.write(
            path.join(dir, ".kilo", "mcp.json"),
            JSON.stringify({
              mcpServers: {
                myserver: { command: "new-cmd", args: ["new"] },
              },
            }),
          )
        },
      })

      const result = await McpMigrator.migrate({
        projectDir: tmp.path,
        skipGlobalPaths: true,
      })

      expect(result.mcp.myserver).toEqual({
        type: "local",
        command: ["new-cmd", "new"],
      })
    })

    test("imports disabled servers with enabled: false", async () => {
      await using tmp = await tmpdir({
        init: async (dir) => {
          const settingsDir = path.join(dir, ".kilo")
          await Bun.write(
            path.join(settingsDir, "mcp.json"),
            JSON.stringify({
              mcpServers: {
                enabled: { command: "enabled-cmd" },
                disabled: { command: "disabled-cmd", disabled: true },
              },
            }),
          )
        },
      })

      const result = await McpMigrator.migrate({
        projectDir: tmp.path,
        skipGlobalPaths: true,
      })

      expect(result.mcp).toHaveProperty("enabled")
      expect(result.mcp.enabled).toEqual({
        type: "local",
        command: ["enabled-cmd"],
      })
      expect(result.mcp).toHaveProperty("disabled")
      expect(result.mcp.disabled).toEqual({
        type: "local",
        command: ["disabled-cmd"],
        enabled: false,
      })
    })

    test("warns about alwaysAllow permissions that cannot be migrated", async () => {
      await using tmp = await tmpdir({
        init: async (dir) => {
          const settingsDir = path.join(dir, ".kilo")
          await Bun.write(
            path.join(settingsDir, "mcp.json"),
            JSON.stringify({
              mcpServers: {
                filesystem: {
                  command: "npx",
                  args: ["-y", "@modelcontextprotocol/server-filesystem"],
                  alwaysAllow: ["read_file", "list_directory", "write_file"],
                },
              },
            }),
          )
        },
      })

      const result = await McpMigrator.migrate({
        projectDir: tmp.path,
        skipGlobalPaths: true,
      })

      expect(result.mcp).toHaveProperty("filesystem")
      expect(result.warnings.some((w) => w.includes("alwaysAllow"))).toBe(true)
      expect(result.warnings.some((w) => w.includes("read_file"))).toBe(true)
      expect(result.warnings.some((w) => w.includes("filesystem"))).toBe(true)
    })

    test("migrates multiple servers correctly", async () => {
      await using tmp = await tmpdir({
        init: async (dir) => {
          const settingsDir = path.join(dir, ".kilo")
          await Bun.write(
            path.join(settingsDir, "mcp.json"),
            JSON.stringify({
              mcpServers: {
                filesystem: {
                  command: "npx",
                  args: ["-y", "@modelcontextprotocol/server-filesystem"],
                },
                github: {
                  command: "npx",
                  args: ["-y", "@modelcontextprotocol/server-github"],
                  env: { GITHUB_TOKEN: "token123" },
                },
                postgres: {
                  command: "npx",
                  args: ["-y", "@modelcontextprotocol/server-postgres"],
                  env: { DATABASE_URL: "postgres://localhost/db" },
                },
              },
            }),
          )
        },
      })

      const result = await McpMigrator.migrate({
        projectDir: tmp.path,
        skipGlobalPaths: true,
      })

      expect(Object.keys(result.mcp)).toHaveLength(3)
      const filesystem = result.mcp.filesystem
      const github = result.mcp.github
      const postgres = result.mcp.postgres
      if (filesystem.type === "local" && github.type === "local" && postgres.type === "local") {
        expect(filesystem.command).toEqual(["npx", "-y", "@modelcontextprotocol/server-filesystem"])
        expect(github.environment).toEqual({ GITHUB_TOKEN: "token123" })
        expect(postgres.environment).toEqual({ DATABASE_URL: "postgres://localhost/db" })
      }
    })

    test("handles empty mcpServers object", async () => {
      await using tmp = await tmpdir({
        init: async (dir) => {
          const settingsDir = path.join(dir, ".kilo")
          await Bun.write(
            path.join(settingsDir, "mcp.json"),
            JSON.stringify({
              mcpServers: {},
            }),
          )
        },
      })

      const result = await McpMigrator.migrate({
        projectDir: tmp.path,
        skipGlobalPaths: true,
      })

      expect(Object.keys(result.mcp)).toHaveLength(0)
    })

    // Regression: project-level MCP settings use mcp.json, not mcp_settings.json
    test("does not read project-level .kilo/mcp_settings.json", async () => {
      await using tmp = await tmpdir({
        init: async (dir) => {
          const settingsDir = path.join(dir, ".kilo")
          await Bun.write(
            path.join(settingsDir, "mcp_settings.json"),
            JSON.stringify({
              mcpServers: {
                wrong: { command: "should-not-be-found" },
              },
            }),
          )
        },
      })

      const result = await McpMigrator.migrate({
        projectDir: tmp.path,
        skipGlobalPaths: true,
      })

      expect(Object.keys(result.mcp)).toHaveLength(0)
    })
  })

  describe("remote server migration", () => {
    describe("convertServer", () => {
      test("converts streamable-http server to remote type", () => {
        const server = {
          type: "streamable-http",
          url: "http://localhost:4321/mcp",
        } as any

        const result = McpMigrator.convertServer("local-mcp", server)

        expect(result).toEqual({
          type: "remote",
          url: "http://localhost:4321/mcp",
        })
      })

      test("converts sse server to remote type", () => {
        const server = {
          type: "sse",
          url: "https://mcp.example.com/sse",
        } as any

        const result = McpMigrator.convertServer("sse-server", server)

        expect(result).toEqual({
          type: "remote",
          url: "https://mcp.example.com/sse",
        })
      })

      test("converts remote server with headers", () => {
        const server = {
          type: "streamable-http",
          url: "https://mcp.example.com/api",
          headers: {
            Authorization: "Bearer token123",
            "X-Custom-Header": "value",
          },
        } as any

        const result = McpMigrator.convertServer("auth-server", server)

        expect(result).toEqual({
          type: "remote",
          url: "https://mcp.example.com/api",
          headers: {
            Authorization: "Bearer token123",
            "X-Custom-Header": "value",
          },
        })
      })

      test("converts disabled remote server with enabled: false", () => {
        const server = {
          type: "streamable-http",
          url: "http://localhost:4321/mcp",
          disabled: true,
        } as any

        const result = McpMigrator.convertServer("disabled-remote", server)

        expect(result).toEqual({
          type: "remote",
          url: "http://localhost:4321/mcp",
          enabled: false,
        })
      })

      test("omits headers when not provided on remote server", () => {
        const server = {
          type: "sse",
          url: "https://mcp.example.com/sse",
        } as any

        const result = McpMigrator.convertServer("no-headers", server)

        expect(result).not.toHaveProperty("headers")
      })

      test("omits headers when empty object on remote server", () => {
        const server = {
          type: "streamable-http",
          url: "https://mcp.example.com/api",
          headers: {},
        } as any

        const result = McpMigrator.convertServer("empty-headers", server)

        expect(result).not.toHaveProperty("headers")
      })
    })

    describe("migrate", () => {
      test("migrates streamable-http server from project settings", async () => {
        await using tmp = await tmpdir({
          init: async (dir) => {
            const settingsDir = path.join(dir, ".kilo")
            await Bun.write(
              path.join(settingsDir, "mcp.json"),
              JSON.stringify({
                mcpServers: {
                  "local-mcp": {
                    type: "streamable-http",
                    url: "http://localhost:4321/mcp",
                  },
                },
              }),
            )
          },
        })

        const result = await McpMigrator.migrate({
          projectDir: tmp.path,
          skipGlobalPaths: true,
        })

        expect(result.mcp).toHaveProperty("local-mcp")
        expect(result.mcp["local-mcp"]).toEqual({
          type: "remote",
          url: "http://localhost:4321/mcp",
        })
      })

      test("migrates sse server from project settings", async () => {
        await using tmp = await tmpdir({
          init: async (dir) => {
            const settingsDir = path.join(dir, ".kilo")
            await Bun.write(
              path.join(settingsDir, "mcp.json"),
              JSON.stringify({
                mcpServers: {
                  "sse-server": {
                    type: "sse",
                    url: "https://mcp.example.com/sse",
                  },
                },
              }),
            )
          },
        })

        const result = await McpMigrator.migrate({
          projectDir: tmp.path,
          skipGlobalPaths: true,
        })

        expect(result.mcp).toHaveProperty("sse-server")
        expect(result.mcp["sse-server"]).toEqual({
          type: "remote",
          url: "https://mcp.example.com/sse",
        })
      })

      test("migrates mixed stdio and remote servers", async () => {
        await using tmp = await tmpdir({
          init: async (dir) => {
            const settingsDir = path.join(dir, ".kilo")
            await Bun.write(
              path.join(settingsDir, "mcp.json"),
              JSON.stringify({
                mcpServers: {
                  filesystem: {
                    command: "npx",
                    args: ["-y", "@modelcontextprotocol/server-filesystem"],
                  },
                  "remote-api": {
                    type: "streamable-http",
                    url: "http://localhost:4321/mcp",
                  },
                  "sse-api": {
                    type: "sse",
                    url: "https://mcp.example.com/sse",
                    headers: { Authorization: "Bearer secret" },
                  },
                },
              }),
            )
          },
        })

        const result = await McpMigrator.migrate({
          projectDir: tmp.path,
          skipGlobalPaths: true,
        })

        expect(Object.keys(result.mcp)).toHaveLength(3)
        expect(result.mcp.filesystem).toEqual({
          type: "local",
          command: ["npx", "-y", "@modelcontextprotocol/server-filesystem"],
        })
        expect(result.mcp["remote-api"]).toEqual({
          type: "remote",
          url: "http://localhost:4321/mcp",
        })
        expect(result.mcp["sse-api"]).toEqual({
          type: "remote",
          url: "https://mcp.example.com/sse",
          headers: { Authorization: "Bearer secret" },
        })
      })

      test("migrates remote server with headers and auth", async () => {
        await using tmp = await tmpdir({
          init: async (dir) => {
            const settingsDir = path.join(dir, ".kilo")
            await Bun.write(
              path.join(settingsDir, "mcp.json"),
              JSON.stringify({
                mcpServers: {
                  "auth-api": {
                    type: "streamable-http",
                    url: "https://api.example.com/mcp",
                    headers: {
                      Authorization: "Bearer token123",
                      "X-API-Key": "key456",
                    },
                  },
                },
              }),
            )
          },
        })

        const result = await McpMigrator.migrate({
          projectDir: tmp.path,
          skipGlobalPaths: true,
        })

        expect(result.mcp).toHaveProperty("auth-api")
        expect(result.mcp["auth-api"]).toEqual({
          type: "remote",
          url: "https://api.example.com/mcp",
          headers: {
            Authorization: "Bearer token123",
            "X-API-Key": "key456",
          },
        })
      })

      test("imports disabled remote servers with enabled: false", async () => {
        await using tmp = await tmpdir({
          init: async (dir) => {
            const settingsDir = path.join(dir, ".kilo")
            await Bun.write(
              path.join(settingsDir, "mcp.json"),
              JSON.stringify({
                mcpServers: {
                  enabled: {
                    type: "streamable-http",
                    url: "http://localhost:4321/mcp",
                  },
                  disabled: {
                    type: "streamable-http",
                    url: "http://localhost:4322/mcp",
                    disabled: true,
                  },
                },
              }),
            )
          },
        })

        const result = await McpMigrator.migrate({
          projectDir: tmp.path,
          skipGlobalPaths: true,
        })

        expect(result.mcp).toHaveProperty("enabled")
        expect(result.mcp.enabled).toEqual({
          type: "remote",
          url: "http://localhost:4321/mcp",
        })
        expect(result.mcp).toHaveProperty("disabled")
        expect(result.mcp.disabled).toEqual({
          type: "remote",
          url: "http://localhost:4322/mcp",
          enabled: false,
        })
      })
    })
  })
})
