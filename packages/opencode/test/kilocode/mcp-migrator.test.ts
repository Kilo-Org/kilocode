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

    test("returns null for disabled servers", () => {
      const server: McpMigrator.KilocodeMcpServer = {
        command: "npx",
        args: ["-y", "some-package"],
        disabled: true,
      }

      const result = McpMigrator.convertServer("disabled-server", server)

      expect(result).toBeNull()
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

    test("migrates servers from project .kilocode/mcp.json", async () => {
      await using tmp = await tmpdir({
        init: async (dir) => {
          const settingsDir = path.join(dir, ".kilocode")
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

    test("skips disabled servers and records them", async () => {
      await using tmp = await tmpdir({
        init: async (dir) => {
          const settingsDir = path.join(dir, ".kilocode")
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
      expect(result.mcp).not.toHaveProperty("disabled")
      expect(result.skipped).toContainEqual({
        name: "disabled",
        reason: "Server is disabled",
      })
    })

    test("warns about alwaysAllow permissions that cannot be migrated", async () => {
      await using tmp = await tmpdir({
        init: async (dir) => {
          const settingsDir = path.join(dir, ".kilocode")
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
          const settingsDir = path.join(dir, ".kilocode")
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
          const settingsDir = path.join(dir, ".kilocode")
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
    test("does not read project-level .kilocode/mcp_settings.json", async () => {
      await using tmp = await tmpdir({
        init: async (dir) => {
          const settingsDir = path.join(dir, ".kilocode")
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
      test("converts streamable-http server", () => {
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

      test("converts sse server", () => {
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
          url: "https://mcp.example.com/mcp",
          headers: {
            Authorization: "Bearer token123",
            "X-Custom": "value",
          },
        } as any

        const result = McpMigrator.convertServer("auth-server", server)

        expect(result).toEqual({
          type: "remote",
          url: "https://mcp.example.com/mcp",
          headers: {
            Authorization: "Bearer token123",
            "X-Custom": "value",
          },
        })
      })

      test("returns null for disabled remote server", () => {
        const server = {
          type: "streamable-http",
          url: "http://localhost:4321/mcp",
          disabled: true,
        } as any

        const result = McpMigrator.convertServer("disabled-remote", server)

        expect(result).toBeNull()
      })

      test("converts remote server without explicit type but with url", () => {
        const server = {
          url: "http://localhost:4321/mcp",
        } as any

        const result = McpMigrator.convertServer("url-only", server)

        expect(result).toEqual({
          type: "remote",
          url: "http://localhost:4321/mcp",
        })
      })

      test("omits headers when not provided on remote server", () => {
        const server = {
          type: "streamable-http",
          url: "http://localhost:4321/mcp",
        } as any

        const result = McpMigrator.convertServer("no-headers", server)

        expect(result).not.toHaveProperty("headers")
      })
    })

    describe("migrate", () => {
      test("migrates streamable-http server from project settings", async () => {
        await using tmp = await tmpdir({
          init: async (dir) => {
            const settingsDir = path.join(dir, ".kilocode")
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

      test("migrates mixed stdio and remote servers", async () => {
        await using tmp = await tmpdir({
          init: async (dir) => {
            const settingsDir = path.join(dir, ".kilocode")
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
                    url: "https://api.example.com/mcp",
                    headers: { Authorization: "Bearer secret" },
                  },
                  "sse-server": {
                    type: "sse",
                    url: "https://sse.example.com/mcp",
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

        // stdio server should be local
        expect(result.mcp.filesystem).toEqual({
          type: "local",
          command: ["npx", "-y", "@modelcontextprotocol/server-filesystem"],
        })

        // streamable-http server should be remote
        expect(result.mcp["remote-api"]).toEqual({
          type: "remote",
          url: "https://api.example.com/mcp",
          headers: { Authorization: "Bearer secret" },
        })

        // sse server should be remote
        expect(result.mcp["sse-server"]).toEqual({
          type: "remote",
          url: "https://sse.example.com/mcp",
        })
      })

      test("skips disabled remote server and records it", async () => {
        await using tmp = await tmpdir({
          init: async (dir) => {
            const settingsDir = path.join(dir, ".kilocode")
            await Bun.write(
              path.join(settingsDir, "mcp.json"),
              JSON.stringify({
                mcpServers: {
                  "active-remote": {
                    type: "streamable-http",
                    url: "http://localhost:4321/mcp",
                  },
                  "disabled-remote": {
                    type: "streamable-http",
                    url: "http://localhost:9999/mcp",
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

        expect(result.mcp).toHaveProperty("active-remote")
        expect(result.mcp).not.toHaveProperty("disabled-remote")
        expect(result.skipped).toContainEqual({
          name: "disabled-remote",
          reason: "Server is disabled",
        })
      })
    })
  })
})
