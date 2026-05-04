import * as path from "path"
import { existsSync } from "fs"
import type { Parser as ParserT, Language as LanguageT, Query as QueryT } from "web-tree-sitter"
import {
  javascriptQuery,
  typescriptQuery,
  tsxQuery,
  pythonQuery,
  rustQuery,
  goQuery,
  cppQuery,
  cQuery,
  csharpQuery,
  rubyQuery,
  javaQuery,
  phpQuery,
  htmlQuery,
  swiftQuery,
  kotlinQuery,
  cssQuery,
  ocamlQuery,
  solidityQuery,
  tomlQuery,
  vueQuery,
  luaQuery,
  systemrdlQuery,
  tlaPlusQuery,
  zigQuery,
  embeddedTemplateQuery,
  elispQuery,
  elixirQuery,
} from "./queries"
import { Log } from "../util/log"

const log = Log.create({ service: "tree-sitter-parser" })

export interface LanguageParser {
  [key: string]: {
    parser: ParserT
    query: QueryT
  }
}

function resolveModulePath(specifier: string): string | undefined {
  try {
    return require.resolve(specifier)
  } catch {
    return
  }
}

function uniquePaths(paths: Array<string | undefined>): string[] {
  return [...new Set(paths.filter((item): item is string => !!item))]
}

function wasmDirectories(sourceDirectory?: string): string[] {
  const baseDir = sourceDirectory || __dirname
  const execDir = path.dirname(process.execPath)
  const envDir = process.env.KILO_TREE_SITTER_WASM_DIR
  const wasmPkg = resolveModulePath("tree-sitter-wasms/package.json")
  const wasmOutDir = wasmPkg ? path.join(path.dirname(wasmPkg), "out") : undefined

  return uniquePaths([
    baseDir,
    path.join(baseDir, "tree-sitter"),
    execDir,
    path.join(execDir, "tree-sitter"),
    envDir,
    wasmOutDir,
  ])
}

function resolveFromDirectories(file: string, dirs: string[]): string | undefined {
  for (const dir of dirs) {
    const candidate = path.join(dir, file)
    if (!existsSync(candidate)) {
      continue
    }
    return candidate
  }
}

function resolveCoreRuntimeWasmPath(sourceDirectory?: string): string | undefined {
  const dirs = wasmDirectories(sourceDirectory)
  const localPath = resolveFromDirectories("tree-sitter.wasm", dirs)
  if (localPath) {
    return localPath
  }
  return resolveModulePath("web-tree-sitter/tree-sitter.wasm")
}

function resolveLanguageWasmPath(langName: string, sourceDirectory?: string) {
  const dirs = wasmDirectories(sourceDirectory)
  const fileName = `tree-sitter-${langName}.wasm`
  const wasmPath = resolveFromDirectories(fileName, dirs)
  const searchedPaths = dirs.map((dir) => path.join(dir, fileName))

  return {
    wasmPath,
    searchedPaths,
  }
}

async function loadLanguage(langName: string, sourceDirectory?: string) {
  const { Language } = require("web-tree-sitter")
  const resolved = resolveLanguageWasmPath(langName, sourceDirectory)

  if (!resolved.wasmPath) {
    log.error(`Failed to resolve language WASM: ${langName}`, {
      searchedPaths: resolved.searchedPaths,
    })
    throw new Error(`Missing tree-sitter language WASM: ${langName}`)
  }

  try {
    return await Language.load(resolved.wasmPath)
  } catch (error) {
    log.warn(`language WASM unavailable: ${langName}`, {
      wasmPath: resolved.wasmPath,
      err: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}

let isParserInitialized = false

/*
RATIONALE: Uses web-tree-sitter WASM modules instead of native node bindings
to avoid architecture-specific build issues. Each language's grammar is loaded
from a .wasm file on demand based on the file extensions being parsed.

Sources:
- https://github.com/tree-sitter/tree-sitter/blob/master/lib/binding_web/README.md
- https://github.com/Gregoor/tree-sitter-wasms/blob/main/README.md
*/
export async function loadRequiredLanguageParsers(filesToParse: string[], sourceDirectory?: string) {
  const { Parser, Query } = require("web-tree-sitter")

  if (!isParserInitialized) {
    try {
      const runtimeWasmPath = resolveCoreRuntimeWasmPath(sourceDirectory)
      await (runtimeWasmPath
        ? Parser.init({
            locateFile() {
              return runtimeWasmPath
            },
          })
        : Parser.init())
      isParserInitialized = true
    } catch (error) {
      log.error("Failed to initialize tree-sitter parser", {
        err: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  }

  const extensionsToLoad = new Set(filesToParse.map((file) => path.extname(file).toLowerCase().slice(1)))
  const parsers: LanguageParser = {}

  for (const ext of extensionsToLoad) {
    let language: LanguageT
    let query: QueryT
    let parserKey = ext

    switch (ext) {
      case "js":
      case "jsx":
      case "json":
        language = await loadLanguage("javascript", sourceDirectory)
        query = new Query(language, javascriptQuery)
        break
      case "ts":
        language = await loadLanguage("typescript", sourceDirectory)
        query = new Query(language, typescriptQuery)
        break
      case "tsx":
        language = await loadLanguage("tsx", sourceDirectory)
        query = new Query(language, tsxQuery)
        break
      case "py":
        language = await loadLanguage("python", sourceDirectory)
        query = new Query(language, pythonQuery)
        break
      case "rs":
        language = await loadLanguage("rust", sourceDirectory)
        query = new Query(language, rustQuery)
        break
      case "go":
        language = await loadLanguage("go", sourceDirectory)
        query = new Query(language, goQuery)
        break
      case "cpp":
      case "hpp":
        language = await loadLanguage("cpp", sourceDirectory)
        query = new Query(language, cppQuery)
        break
      case "c":
      case "h":
        language = await loadLanguage("c", sourceDirectory)
        query = new Query(language, cQuery)
        break
      case "cs":
        language = await loadLanguage("c_sharp", sourceDirectory)
        query = new Query(language, csharpQuery)
        break
      case "rb":
        language = await loadLanguage("ruby", sourceDirectory)
        query = new Query(language, rubyQuery)
        break
      case "java":
        language = await loadLanguage("java", sourceDirectory)
        query = new Query(language, javaQuery)
        break
      case "php":
        language = await loadLanguage("php", sourceDirectory)
        query = new Query(language, phpQuery)
        break
      case "swift":
        language = await loadLanguage("swift", sourceDirectory)
        query = new Query(language, swiftQuery)
        break
      case "kt":
      case "kts":
        language = await loadLanguage("kotlin", sourceDirectory)
        query = new Query(language, kotlinQuery)
        break
      case "css":
        language = await loadLanguage("css", sourceDirectory)
        query = new Query(language, cssQuery)
        break
      case "html":
        language = await loadLanguage("html", sourceDirectory)
        query = new Query(language, htmlQuery)
        break
      case "ml":
      case "mli":
        language = await loadLanguage("ocaml", sourceDirectory)
        query = new Query(language, ocamlQuery)
        break
      case "scala":
        language = await loadLanguage("scala", sourceDirectory)
        query = new Query(language, luaQuery) // COMPAT: Uses Lua query until Scala is implemented
        break
      case "sol":
        language = await loadLanguage("solidity", sourceDirectory)
        query = new Query(language, solidityQuery)
        break
      case "toml":
        language = await loadLanguage("toml", sourceDirectory)
        query = new Query(language, tomlQuery)
        break
      case "vue":
        language = await loadLanguage("vue", sourceDirectory)
        query = new Query(language, vueQuery)
        break
      case "lua":
        language = await loadLanguage("lua", sourceDirectory)
        query = new Query(language, luaQuery)
        break
      case "rdl":
        language = await loadLanguage("systemrdl", sourceDirectory)
        query = new Query(language, systemrdlQuery)
        break
      case "tla":
        language = await loadLanguage("tlaplus", sourceDirectory)
        query = new Query(language, tlaPlusQuery)
        break
      case "zig":
        language = await loadLanguage("zig", sourceDirectory)
        query = new Query(language, zigQuery)
        break
      case "ejs":
      case "erb":
        parserKey = "embedded_template"
        language = await loadLanguage("embedded_template", sourceDirectory)
        query = new Query(language, embeddedTemplateQuery)
        break
      case "el":
        language = await loadLanguage("elisp", sourceDirectory)
        query = new Query(language, elispQuery)
        break
      case "ex":
      case "exs":
        language = await loadLanguage("elixir", sourceDirectory)
        query = new Query(language, elixirQuery)
        break
      default:
        throw new Error(`Unsupported language: ${ext}`)
    }

    const parser = new Parser()
    parser.setLanguage(language)
    parsers[parserKey] = { parser, query }
  }

  return parsers
}
