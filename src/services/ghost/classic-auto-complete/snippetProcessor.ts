import * as vscode from "vscode"
import { ContextRetrievalService } from "../../continuedev/core/autocomplete/context/ContextRetrievalService"
import { VsCodeIde } from "../../continuedev/core/vscode-test-harness/src/VSCodeIde"
import { AutocompleteInput } from "../types"
import { HelperVars } from "../../continuedev/core/autocomplete/util/HelperVars"
import { getAllSnippetsWithoutRace } from "../../continuedev/core/autocomplete/snippets/getAllSnippets"
import { getDefinitionsFromLsp } from "../../continuedev/core/vscode-test-harness/src/autocomplete/lsp"
import { DEFAULT_AUTOCOMPLETE_OPTS } from "../../continuedev/core/util/parameters"
import { getSnippets } from "../../continuedev/core/autocomplete/templating/filtering"
import { RooIgnoreController } from "../../../core/ignore/RooIgnoreController"
import { AutocompleteSnippet, AutocompleteSnippetType } from "../../continuedev/core/autocomplete/snippets/types"

export interface ProcessedSnippetsResult {
	filepathUri: string
	helper: HelperVars
	snippetsWithUris: AutocompleteSnippet[]
	workspaceDirs: string[]
}

function uriToFsPath(filepath: string): string {
	if (filepath.startsWith("file://")) {
		return vscode.Uri.parse(filepath).fsPath
	}
	return filepath
}

function hasFilepath(snippet: AutocompleteSnippet): snippet is AutocompleteSnippet & { filepath?: string } {
	return snippet.type === AutocompleteSnippetType.Code || snippet.type === AutocompleteSnippetType.Static
}

async function filterSnippetsByAccess(
	snippets: AutocompleteSnippet[],
	ignoreController?: Promise<RooIgnoreController>,
): Promise<AutocompleteSnippet[]> {
	if (!ignoreController) {
		return snippets
	}

	try {
		// Try to get the controller, but don't wait too long
		const controller = await Promise.race([
			ignoreController,
			new Promise<null>((resolve) => setTimeout(() => resolve(null), 100)),
		])

		if (!controller) {
			// If promise hasn't resolved yet, assume files are ignored (as per requirement)
			return snippets.filter((snippet) => {
				// Only keep snippets without file paths (Diff, Clipboard)
				return !hasFilepath(snippet) || !snippet.filepath
			})
		}

		return snippets.filter((snippet) => {
			if (hasFilepath(snippet) && snippet.filepath) {
				const fsPath = uriToFsPath(snippet.filepath)
				const hasAccess = controller.validateAccess(fsPath)
				return hasAccess
			}

			// Keep all other snippet types (Diff, Clipboard) that don't have file paths
			return true
		})
	} catch (error) {
		console.error("[snippetProcessor] Error filtering snippets by access:", error)
		// On error, be conservative and filter out file-based snippets
		return snippets.filter((snippet) => {
			return !hasFilepath(snippet) || !snippet.filepath
		})
	}
}

/**
 * Process snippets for autocomplete context.
 * This function handles:
 * - Initializing import definitions cache
 * - Creating HelperVars for the autocomplete input
 * - Getting all snippets from various sources
 * - Filtering snippets by access permissions
 * - Converting filepaths to URIs
 */
export async function getProcessedSnippets(
	autocompleteInput: AutocompleteInput,
	filepath: string,
	ide: VsCodeIde,
	contextService: ContextRetrievalService,
	modelName: string,
	ignoreController?: Promise<RooIgnoreController>,
): Promise<ProcessedSnippetsResult> {
	// Convert filepath to URI if it's not already one
	const filepathUri = filepath.startsWith("file://") ? filepath : vscode.Uri.file(filepath).toString()

	// Initialize import definitions cache
	// this looks like a race, but the contextService only prefetches data here; it's not a mode switch.
	// This odd-looking API seems to be an optimization that's used in continue but not (currently) in our codebase,
	// continue preloads the tree-sitter parse on text editor tab switch to reduce autocomplete latency.
	await contextService.initializeForFile(filepathUri)

	// Create helper with URI filepath
	const helperInput = {
		...autocompleteInput,
		filepath: filepathUri,
	}

	const helper = await HelperVars.create(helperInput as any, DEFAULT_AUTOCOMPLETE_OPTS, modelName, ide)

	const snippetPayload = await getAllSnippetsWithoutRace({
		helper,
		ide,
		getDefinitionsFromLsp,
		contextRetrievalService: contextService,
	})

	const filteredSnippets = getSnippets(helper, snippetPayload)

	// Apply access filtering to remove snippets from blocked files
	const accessibleSnippets = await filterSnippetsByAccess(filteredSnippets, ignoreController)

	// Convert all snippet filepaths to URIs
	const snippetsWithUris = accessibleSnippets.map((snippet: any) => ({
		...snippet,
		filepath: snippet.filepath?.startsWith("file://")
			? snippet.filepath
			: vscode.Uri.file(snippet.filepath).toString(),
	}))

	const workspaceDirs = await ide.getWorkspaceDirs()

	return { filepathUri, helper, snippetsWithUris, workspaceDirs }
}
