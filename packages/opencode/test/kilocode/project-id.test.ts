import { test, expect, describe } from "bun:test"
import { tmpdir } from "../fixture/fixture"
import path from "path"
import fs from "fs/promises"
import { Instance } from "../../src/project/instance"
import { getKiloProjectId } from "../../src/kilocode/project-id"

describe("project-id", () => {
  describe("normalization", () => {
    test("extracts repo name from HTTPS git URL", async () => {
      await using tmp = await tmpdir({
        git: true,
        init: async (dir) => {
          // Set git origin to HTTPS URL
          await Bun.$`git remote add origin https://github.com/Kilo-Org/handbook.git`.cwd(dir).quiet()
        },
      })

      const id = await Instance.provide({
        directory: tmp.path,
        fn: () => getKiloProjectId(),
      })

      expect(id).toBe("handbook")
    })

    test("extracts repo name from SSH git URL", async () => {
      await using tmp = await tmpdir({
        git: true,
        init: async (dir) => {
          // Set git origin to SSH URL
          await Bun.$`git remote add origin git@github.com:Kilo-Org/handbook.git`.cwd(dir).quiet()
        },
      })

      const id = await Instance.provide({
        directory: tmp.path,
        fn: () => getKiloProjectId(),
      })

      expect(id).toBe("handbook")
    })

    test("extracts repo name from HTTPS URL without .git extension", async () => {
      await using tmp = await tmpdir({
        git: true,
        init: async (dir) => {
          await Bun.$`git remote add origin https://github.com/Kilo-Org/handbook`.cwd(dir).quiet()
        },
      })

      const id = await Instance.provide({
        directory: tmp.path,
        fn: () => getKiloProjectId(),
      })

      expect(id).toBe("handbook")
    })

    test("extracts repo name from ssh:// URL", async () => {
      await using tmp = await tmpdir({
        git: true,
        init: async (dir) => {
          await Bun.$`git remote add origin ssh://git@github.com/Kilo-Org/handbook.git`.cwd(dir).quiet()
        },
      })

      const id = await Instance.provide({
        directory: tmp.path,
        fn: () => getKiloProjectId(),
      })

      expect(id).toBe("handbook")
    })

    test("truncates long repo names to 100 characters", async () => {
      const longName = "a".repeat(150)
      await using tmp = await tmpdir({
        git: true,
        init: async (dir) => {
          await Bun.$`git remote add origin https://github.com/Kilo-Org/${longName}.git`.cwd(dir).quiet()
        },
      })

      const id = await Instance.provide({
        directory: tmp.path,
        fn: () => getKiloProjectId(),
      })

      expect(id).toBe(longName.slice(-100))
    })
  })

  describe("config file priority", () => {
    test("uses project.id from .kilo/config.json", async () => {
      await using tmp = await tmpdir({
        git: true,
        init: async (dir) => {
          // Create config with project ID
          await fs.mkdir(path.join(dir, ".kilo"), { recursive: true })
          await Bun.write(
            path.join(dir, ".kilo", "config.json"),
            JSON.stringify({
              project: {
                id: "my-custom-project",
              },
            }),
          )

          // Also set git origin - config should take priority
          await Bun.$`git remote add origin https://github.com/Kilo-Org/handbook.git`.cwd(dir).quiet()
        },
      })

      const id = await Instance.provide({
        directory: tmp.path,
        fn: () => getKiloProjectId(),
      })

      expect(id).toBe("my-custom-project")
    })

    test("falls back to .kilocode/config.json when .kilo/config.json is absent", async () => {
      await using tmp = await tmpdir({
        git: true,
        init: async (dir) => {
          await fs.mkdir(path.join(dir, ".kilocode"), { recursive: true })
          await Bun.write(
            path.join(dir, ".kilocode", "config.json"),
            JSON.stringify({
              project: {
                id: "legacy-project",
              },
            }),
          )
        },
      })

      const id = await Instance.provide({
        directory: tmp.path,
        fn: () => getKiloProjectId(),
      })

      expect(id).toBe("legacy-project")
    })

    test("prefers .kilo/config.json over .kilocode/config.json", async () => {
      await using tmp = await tmpdir({
        git: true,
        init: async (dir) => {
          await fs.mkdir(path.join(dir, ".kilo"), { recursive: true })
          await Bun.write(path.join(dir, ".kilo", "config.json"), JSON.stringify({ project: { id: "new-project" } }))
          await fs.mkdir(path.join(dir, ".kilocode"), { recursive: true })
          await Bun.write(
            path.join(dir, ".kilocode", "config.json"),
            JSON.stringify({ project: { id: "old-project" } }),
          )
        },
      })

      const id = await Instance.provide({
        directory: tmp.path,
        fn: () => getKiloProjectId(),
      })

      expect(id).toBe("new-project")
    })

    test("normalizes git URL in config file project.id", async () => {
      await using tmp = await tmpdir({
        git: true,
        init: async (dir) => {
          await fs.mkdir(path.join(dir, ".kilo"), { recursive: true })
          await Bun.write(
            path.join(dir, ".kilo", "config.json"),
            JSON.stringify({
              project: {
                id: "https://github.com/Kilo-Org/another-repo.git",
              },
            }),
          )
        },
      })

      const id = await Instance.provide({
        directory: tmp.path,
        fn: () => getKiloProjectId(),
      })

      expect(id).toBe("another-repo")
    })

    test("falls back to git origin when config file has no project.id", async () => {
      await using tmp = await tmpdir({
        git: true,
        init: async (dir) => {
          await fs.mkdir(path.join(dir, ".kilo"), { recursive: true })
          await Bun.write(
            path.join(dir, ".kilo", "config.json"),
            JSON.stringify({
              project: {
                managedIndexingEnabled: true,
              },
            }),
          )

          await Bun.$`git remote add origin https://github.com/Kilo-Org/handbook.git`.cwd(dir).quiet()
        },
      })

      const id = await Instance.provide({
        directory: tmp.path,
        fn: () => getKiloProjectId(),
      })

      expect(id).toBe("handbook")
    })

    test("falls back to git origin when config has empty project.id", async () => {
      await using tmp = await tmpdir({
        git: true,
        init: async (dir) => {
          await fs.mkdir(path.join(dir, ".kilo"), { recursive: true })
          await Bun.write(
            path.join(dir, ".kilo", "config.json"),
            JSON.stringify({
              project: {
                id: "",
              },
            }),
          )

          await Bun.$`git remote add origin https://github.com/Kilo-Org/handbook.git`.cwd(dir).quiet()
        },
      })

      const id = await Instance.provide({
        directory: tmp.path,
        fn: () => getKiloProjectId(),
      })

      expect(id).toBe("handbook")
    })

    test("trims whitespace from config file project.id", async () => {
      await using tmp = await tmpdir({
        git: true,
        init: async (dir) => {
          await fs.mkdir(path.join(dir, ".kilo"), { recursive: true })
          await Bun.write(
            path.join(dir, ".kilo", "config.json"),
            JSON.stringify({
              project: {
                id: "  my-project\n",
              },
            }),
          )
        },
      })

      const id = await Instance.provide({
        directory: tmp.path,
        fn: () => getKiloProjectId(),
      })

      expect(id).toBe("my-project")
    })

    test("falls back to git when config has whitespace-only project.id", async () => {
      await using tmp = await tmpdir({
        git: true,
        init: async (dir) => {
          await fs.mkdir(path.join(dir, ".kilo"), { recursive: true })
          await Bun.write(
            path.join(dir, ".kilo", "config.json"),
            JSON.stringify({
              project: {
                id: "  \n\t  ",
              },
            }),
          )

          await Bun.$`git remote add origin https://github.com/Kilo-Org/handbook.git`.cwd(dir).quiet()
        },
      })

      const id = await Instance.provide({
        directory: tmp.path,
        fn: () => getKiloProjectId(),
      })

      expect(id).toBe("handbook")
    })
  })

  describe("fallback behavior", () => {
    test("returns undefined when no config and no git origin", async () => {
      await using tmp = await tmpdir({ git: true })

      const id = await Instance.provide({
        directory: tmp.path,
        fn: () => getKiloProjectId(),
      })

      expect(id).toBeUndefined()
    })

    test("returns undefined for non-git directory", async () => {
      await using tmp = await tmpdir()

      const id = await Instance.provide({
        directory: tmp.path,
        fn: () => getKiloProjectId(),
      })

      expect(id).toBeUndefined()
    })

    test("handles malformed JSON in config file gracefully", async () => {
      await using tmp = await tmpdir({
        git: true,
        init: async (dir) => {
          await fs.mkdir(path.join(dir, ".kilo"), { recursive: true })
          await Bun.write(path.join(dir, ".kilo", "config.json"), "{ invalid json")

          await Bun.$`git remote add origin https://github.com/Kilo-Org/handbook.git`.cwd(dir).quiet()
        },
      })

      const id = await Instance.provide({
        directory: tmp.path,
        fn: () => getKiloProjectId(),
      })

      // Should fall back to git origin
      expect(id).toBe("handbook")
    })

    test("handles config file with non-string project.id", async () => {
      await using tmp = await tmpdir({
        git: true,
        init: async (dir) => {
          await fs.mkdir(path.join(dir, ".kilo"), { recursive: true })
          await Bun.write(
            path.join(dir, ".kilo", "config.json"),
            JSON.stringify({
              project: {
                id: 12345,
              },
            }),
          )

          await Bun.$`git remote add origin https://github.com/Kilo-Org/handbook.git`.cwd(dir).quiet()
        },
      })

      const id = await Instance.provide({
        directory: tmp.path,
        fn: () => getKiloProjectId(),
      })

      // Should fall back to git origin
      expect(id).toBe("handbook")
    })
  })

  describe("caching", () => {
    test("caches project ID per Instance", async () => {
      await using tmp = await tmpdir({
        git: true,
        init: async (dir) => {
          await Bun.$`git remote add origin https://github.com/Kilo-Org/handbook.git`.cwd(dir).quiet()
        },
      })

      const id1 = await Instance.provide({
        directory: tmp.path,
        fn: () => getKiloProjectId(),
      })

      const id2 = await Instance.provide({
        directory: tmp.path,
        fn: () => getKiloProjectId(),
      })

      expect(id1).toBe(id2)
      expect(id1).toBe("handbook")
    })
  })

  describe("edge cases", () => {
    test("handles git URLs with port numbers", async () => {
      await using tmp = await tmpdir({
        git: true,
        init: async (dir) => {
          await Bun.$`git remote add origin https://github.com:443/Kilo-Org/handbook.git`.cwd(dir).quiet()
        },
      })

      const id = await Instance.provide({
        directory: tmp.path,
        fn: () => getKiloProjectId(),
      })

      expect(id).toBe("handbook")
    })

    test("handles plain string project IDs from config", async () => {
      await using tmp = await tmpdir({
        init: async (dir) => {
          await fs.mkdir(path.join(dir, ".kilo"), { recursive: true })
          await Bun.write(
            path.join(dir, ".kilo", "config.json"),
            JSON.stringify({
              project: {
                id: "simple-name",
              },
            }),
          )
        },
      })

      const id = await Instance.provide({
        directory: tmp.path,
        fn: () => getKiloProjectId(),
      })

      expect(id).toBe("simple-name")
    })

    test("truncates plain string project IDs to 100 chars", async () => {
      const longId = "x".repeat(150)
      await using tmp = await tmpdir({
        init: async (dir) => {
          await fs.mkdir(path.join(dir, ".kilo"), { recursive: true })
          await Bun.write(
            path.join(dir, ".kilo", "config.json"),
            JSON.stringify({
              project: {
                id: longId,
              },
            }),
          )
        },
      })

      const id = await Instance.provide({
        directory: tmp.path,
        fn: () => getKiloProjectId(),
      })

      expect(id).toBe(longId.slice(-100))
    })
  })
})
