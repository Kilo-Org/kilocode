import { describe, expect, it } from "bun:test"
import { mergeFileSearchItems } from "../../src/kilo-provider/file-search-items"

describe("mergeFileSearchItems", () => {
  it("puts exact folder matches before file matches", () => {
    const result = mergeFileSearchItems({
      query: "script",
      files: ["script/hooks", "script/release", "script/beta.ts"],
      folders: ["script/", "script/run-script/"],
    })
    expect(result).toEqual([
      { path: "script/", type: "folder" },
      { path: "script/hooks", type: "file" },
      { path: "script/release", type: "file" },
      { path: "script/beta.ts", type: "file" },
      { path: "script/run-script/", type: "folder" },
    ])
  })

  it("does not promote an added folder because the query matches its filesystem prefix", () => {
    // "dev" appears only in the absolute path of the added folder, never in the
    // path within it. Scoring the absolute form lifted every folder beneath
    // that root above folders the query matches just as little.
    const result = mergeFileSearchItems({
      query: "dev",
      files: [],
      folders: ["src/auth", "/home/dev/other/src/lib"],
      relative: new Map([["/home/dev/other/src/lib", "src/lib"]]),
    })
    expect(result.map((item) => item.path)).toEqual(["src/auth", "/home/dev/other/src/lib"])
  })

  it("lets an added folder earn the path-prefix boost", () => {
    // An absolute path never starts with a typed relative path, so this boost
    // was unreachable for added folders and they fell back to an incidental
    // substring hit, tying with folders that only matched by coincidence.
    const result = mergeFileSearchItems({
      query: "src/a",
      files: [],
      folders: ["x/src/all", "/home/dev/other/src/auth"],
      relative: new Map([["/home/dev/other/src/auth", "src/auth"]]),
    })
    expect(result.map((item) => item.path)).toEqual(["/home/dev/other/src/auth", "x/src/all"])
  })

  it("keeps file ordering before non-prefix folder matches", () => {
    const result = mergeFileSearchItems({
      query: "test",
      files: ["src/test.ts"],
      folders: ["src/latest/"],
    })
    expect(result).toEqual([
      { path: "src/test.ts", type: "file" },
      { path: "src/latest/", type: "folder" },
    ])
  })

  it("normalizes Windows separators for matching and output", () => {
    const result = mergeFileSearchItems({
      query: "kilo-vscode",
      files: ["packages\\kilo-vscode\\src\\KiloProvider.ts"],
      folders: ["packages\\kilo-vscode\\"],
    })
    expect(result).toEqual([
      { path: "packages/kilo-vscode/", type: "folder" },
      { path: "packages/kilo-vscode/src/KiloProvider.ts", type: "file" },
    ])
  })

  it("keeps active and open file results before prefix folder matches", () => {
    const result = mergeFileSearchItems({
      query: "e",
      files: ["packages/kilo-vscode/src/extension.ts"],
      folders: ["packages/extensions/", "packages/example/", "packages/core/src/effect/"],
      open: new Set(["packages/kilo-vscode/src/extension.ts"]),
    })
    expect(result).toEqual([
      { path: "packages/kilo-vscode/src/extension.ts", type: "opened-file" },
      { path: "packages/extensions/", type: "folder" },
      { path: "packages/example/", type: "folder" },
      { path: "packages/core/src/effect/", type: "folder" },
    ])
  })

  it("keeps opened files as a distinct priority group before non-open files", () => {
    const result = mergeFileSearchItems({
      query: "test",
      files: ["src/test.ts", "src/test-helper.ts"],
      folders: ["test/"],
      open: new Set(["src/test-helper.ts"]),
    })
    expect(result).toEqual([
      { path: "src/test-helper.ts", type: "opened-file" },
      { path: "test/", type: "folder" },
      { path: "src/test.ts", type: "file" },
    ])
  })
})
