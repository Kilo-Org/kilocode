import * as vscode from "vscode"

import type { RangeInFile, SignatureHelp } from "../../../"

type GotoProviderName =
  | "vscode.executeDefinitionProvider"
  | "vscode.executeTypeDefinitionProvider"
  | "vscode.executeDeclarationProvider"
  | "vscode.executeImplementationProvider"

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
