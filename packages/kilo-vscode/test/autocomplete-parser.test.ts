import { build } from "esbuild"
import path from "node:path"
import { expect, test } from "bun:test"
import { getParserForFile, getQueryForFile } from "../src/services/autocomplete/continuedev/core/util/treeSitter"

test("original autocomplete parses TypeScript and loads its real context query", async () => {
  const parser = await getParserForFile("file:///tmp/example.ts")
  if (!parser) throw new Error("TypeScript parser was not loaded")
  const tree = parser.parse("function greet(name: User): User { return name }")
  if (!tree) throw new Error("TypeScript tree was not produced")
  try {
    expect(tree.rootNode.hasError).toBe(false)
    expect(tree.rootNode.namedChildren[0]?.type).toBe("function_declaration")
    const query = await getQueryForFile(
      "file:///tmp/example.ts",
      "root-path-context-queries/typescript/function_declaration.scm",
    )
    if (!query) throw new Error("Original context query was not loaded")
    try {
      expect(query.matches(tree.rootNode).length).toBeGreaterThan(0)
    } finally {
      query.delete()
    }
  } finally {
    tree.delete()
    parser.delete()
  }
})

test("packaged autocomplete parser runs in Node with only bundled grammar assets", async () => {
  const { mkdtemp, cp, rm } = await import("node:fs/promises")
  const { tmpdir } = await import("node:os")
  const directory = await mkdtemp(path.join(tmpdir(), "kilo-parser-package-"))
  try {
    await build({
      entryPoints: [path.resolve("src/services/autocomplete/continuedev/core/util/treeSitter.ts")],
      outfile: path.join(directory, "parser.cjs"),
      bundle: true,
      platform: "node",
      plugins: [
        {
          name: "tree-sitter-node-runtime",
          setup(context) {
            context.onResolve({ filter: /^web-tree-sitter$/ }, () => ({ path: require.resolve("web-tree-sitter") }))
          },
        },
      ],
      format: "cjs",
      external: ["web-tree-sitter/tree-sitter.wasm"],
    })
    await cp(require.resolve("web-tree-sitter/tree-sitter.wasm"), path.join(directory, "tree-sitter.wasm"))
    await cp(
      require.resolve("tree-sitter-wasms/out/tree-sitter-typescript.wasm"),
      path.join(directory, "tree-sitter-typescript.wasm"),
    )
    await cp("src/services/autocomplete/continuedev/tree-sitter", path.join(directory, "tree-sitter"), {
      recursive: true,
    })
    const child = Bun.spawn(
      [
        "node",
        "-e",
        `
      const assert = require('node:assert/strict');
      const api = require('./parser.cjs');
      (async () => {
        const parser = await api.getParserForFile('example.ts');
        assert.ok(parser);
        const tree = parser.parse('function greet(name: User): User { return name }');
        assert.equal(tree.rootNode.hasError, false);
        const query = await api.getQueryForFile('example.ts', 'root-path-context-queries/typescript/function_declaration.scm');
        assert.ok(query.matches(tree.rootNode).length > 0);
        query.delete(); tree.delete(); parser.delete();
        console.log('NODE_PARSER_PASS');
      })().catch(error => { console.error(error); process.exitCode = 1; });
    `,
      ],
      { cwd: directory, stdout: "pipe", stderr: "pipe" },
    )
    const output = await new Response(child.stdout).text()
    const error = await new Response(child.stderr).text()
    expect(await child.exited, output + error).toBe(0)
    expect(output).toContain("NODE_PARSER_PASS")
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
