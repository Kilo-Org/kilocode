import * as vscode from "vscode"

import type { DocumentSymbol, RangeInFile, SignatureHelp } from "../../../"

type GotoProviderName =
  | "vscode.executeDefinitionProvider"
  | "vscode.executeTypeDefinitionProvider"
  | "vscode.executeDeclarationProvider"
  | "vscode.executeImplementationProvider"
  | "vscode.executeReferenceProvider"

interface GotoInput {
  uri: vscode.Uri
  line: number
  character: number
  name: GotoProviderName
}
function gotoInputKey(input: GotoInput) {
  return `${input.name}${input.uri.toString()}${input.line}${input.character}`
}

const MAX_CACHE_SIZE = 500
const gotoCache = new Map<string, RangeInFile[]>()

type SignatureHelpProviderName = "vscode.executeSignatureHelpProvider"

interface SignatureHelpInput {
  uri: vscode.Uri
  line: number
  character: number
  name: SignatureHelpProviderName
}
function signatureHelpKey(input: SignatureHelpInput) {
  return `${input.name}${input.uri.toString()}${input.line}${input.character}`
}
const signatureHelpCache = new Map<string, vscode.SignatureHelp>()

export async function executeSignatureHelpProvider(input: SignatureHelpInput): Promise<SignatureHelp | null> {
  const cacheKey = signatureHelpKey(input)
  const cached = signatureHelpCache.get(cacheKey)
  if (cached) {
    return cached as SignatureHelp
  }

  try {
    const definitions = (await vscode.commands.executeCommand(
      input.name,
      input.uri,
      new vscode.Position(input.line, input.character),
    )) as SignatureHelp

    // Add to cache
    if (signatureHelpCache.size >= MAX_CACHE_SIZE) {
      // Remove the oldest item from the cache
      const oldestKey = signatureHelpCache.keys().next().value
      if (oldestKey) {
        signatureHelpCache.delete(oldestKey)
      }
    }
    signatureHelpCache.set(cacheKey, definitions)

    return definitions
  } catch (e) {
    console.warn(`Error executing ${input.name}:`, e)
    return null
  }
}

export async function executeGotoProvider(input: GotoInput): Promise<RangeInFile[]> {
  const cacheKey = gotoInputKey(input)
  const cached = gotoCache.get(cacheKey)
  if (cached) {
    return cached
  }

  try {
    const definitions = (await vscode.commands.executeCommand(
      input.name,
      input.uri,
      new vscode.Position(input.line, input.character),
    )) as any

    const results = definitions
      .filter((d: any) => (d.targetUri || d.uri) && (d.targetRange || d.range))
      .map((d: any) => ({
        filepath: (d.targetUri || d.uri).toString(),
        range: d.targetRange || d.range,
      }))

    // Add to cache
    if (gotoCache.size >= MAX_CACHE_SIZE) {
      // Remove the oldest item from the cache
      const oldestKey = gotoCache.keys().next().value
      if (oldestKey) {
        gotoCache.delete(oldestKey)
      }
    }
    gotoCache.set(cacheKey, results)

    return results
  } catch (e) {
    console.warn(`Error executing ${input.name}:`, e)
    return []
  }
}

type SymbolProviderName = "vscode.executeDocumentSymbolProvider"

interface SymbolInput {
  uri: vscode.Uri
  name: SymbolProviderName
}

function symbolInputKey(input: SymbolInput) {
  return `${input.name}${input.uri.toString()}`
}

const MAX_SYMBOL_CACHE_SIZE = 100
const symbolCache = new Map<string, DocumentSymbol[]>()

export async function executeSymbolProvider(input: SymbolInput): Promise<DocumentSymbol[]> {
  const cacheKey = symbolInputKey(input)
  const cached = symbolCache.get(cacheKey)
  if (cached) {
    return cached
  }

  try {
    const symbols = (await vscode.commands.executeCommand(
      input.name,
      input.uri,
      // )) as vscode.DocumentSymbol[] | vscode.SymbolInformation[];
    )) as vscode.DocumentSymbol[]

    const results: DocumentSymbol[] = []

    // Handle both possible return types from the symbol provider
    if (symbols.length > 0) {
      // if ("location" in symbols[0]) {
      //   // SymbolInformation type
      //   results.push(
      //     ...symbols.map((s: vscode.SymbolInformation) => ({
      //       filepath: s.location.uri.toString(),
      //       range: s.location.range,
      //     })),
      //   );
      // } else {
      // DocumentSymbol type - collect symbols recursively
      function collectSymbols(symbols: vscode.DocumentSymbol[], uri: vscode.Uri): DocumentSymbol[] {
        const result: DocumentSymbol[] = []
        for (const symbol of symbols) {
          result.push({
            name: symbol.name,
            range: symbol.range,
            selectionRange: symbol.selectionRange,
            kind: symbol.kind,
          })

          if (symbol.children && symbol.children.length > 0) {
            result.push(...collectSymbols(symbol.children, uri))
          }
        }
        return result
      }

      results.push(...collectSymbols(symbols as vscode.DocumentSymbol[], input.uri))
      // }
    }

    // Add to cache
    if (symbolCache.size >= MAX_SYMBOL_CACHE_SIZE) {
      // Remove the oldest item from the cache
      const oldestKey = symbolCache.keys().next().value
      if (oldestKey) {
        symbolCache.delete(oldestKey)
      }
    }
    symbolCache.set(cacheKey, results)

    return results
  } catch (e) {
    console.warn(`Error executing ${input.name}:`, e)
    return []
  }
}
