import * as vscode from "vscode"
import { ContextRetrievalService } from "../../continuedev/core/autocomplete/context/ContextRetrievalService"
import { VsCodeIde } from "../../continuedev/core/vscode-test-harness/src/VSCodeIde"
import { AutocompleteInput } from "../types"
import { HelperVars } from "../../continuedev/core/autocomplete/util/HelperVars"
import { getAllSnippetsWithoutRace } from "../../continuedev/core/autocomplete/snippets/getAllSnippets"
import { getDefinitionsFromLsp } from "../../continuedev/core/vscode-test-harness/src/autocomplete/lsp"
import { DEFAULT_AUTOCOMPLETE_OPTS } from "../../continuedev/core/util/parameters"
import { getSnippets } from "../../continuedev/core/autocomplete/templating/filtering"
import { formatSnippets } from "../../continuedev/core/autocomplete/templating/formatting"
import { GhostModel } from "../GhostModel"
import { RooIgnoreController } from "../../../core/ignore/RooIgnoreController"
import { AutocompleteSnippet, AutocompleteSnippetType } from "../../continuedev/core/autocomplete/snippets/types"
import { getLastNUriRelativePathParts, getShortestUniqueRelativeUriPaths } from "../../continuedev/core/util/uri"

export class GhostContextProvider {
	private contextService: ContextRetrievalService
	private ide: VsCodeIde
	private model: GhostModel
	private ignoreController?: Promise<RooIgnoreController>

	constructor(context: vscode.ExtensionContext, model: GhostModel, ignoreController?: Promise<RooIgnoreController>) {
		this.ide = new VsCodeIde(context)
		this.contextService = new ContextRetrievalService(this.ide)
		this.model = model
		this.ignoreController = ignoreController
	}

	/**
	 * Get the IDE instance for use by tracking services
	 */
	public getIde(): VsCodeIde {
		return this.ide
	}

	private uriToFsPath(filepath: string): string {
		if (filepath.startsWith("file://")) {
			return vscode.Uri.parse(filepath).fsPath
		}
		return filepath
	}

	private hasFilepath(snippet: AutocompleteSnippet): snippet is AutocompleteSnippet & { filepath?: string } {
		return snippet.type === AutocompleteSnippetType.Code || snippet.type === AutocompleteSnippetType.Static
	}

	private async filterSnippetsByAccess(snippets: AutocompleteSnippet[]): Promise<AutocompleteSnippet[]> {
		if (!this.ignoreController) {
			return snippets
		}

		try {
			// Try to get the controller, but don't wait too long
			const controller = await Promise.race([
				this.ignoreController,
				new Promise<null>((resolve) => setTimeout(() => resolve(null), 100)),
			])

			if (!controller) {
				// If promise hasn't resolved yet, assume files are ignored (as per requirement)
				return snippets.filter((snippet) => {
					// Only keep snippets without file paths (Diff, Clipboard)
					return !this.hasFilepath(snippet) || !snippet.filepath
				})
			}

			return snippets.filter((snippet) => {
				if (this.hasFilepath(snippet) && snippet.filepath) {
					const fsPath = this.uriToFsPath(snippet.filepath)
					const hasAccess = controller.validateAccess(fsPath)
					return hasAccess
				}

				// Keep all other snippet types (Diff, Clipboard) that don't have file paths
				return true
			})
		} catch (error) {
			console.error("[GhostContextProvider] Error filtering snippets by access:", error)
			// On error, be conservative and filter out file-based snippets
			return snippets.filter((snippet) => {
				return !this.hasFilepath(snippet) || !snippet.filepath
			})
		}
	}

	private async getProcessedSnippets(
		autocompleteInput: AutocompleteInput,
		filepath: string,
	): Promise<{
		filepathUri: string
		helper: any
		snippetsWithUris: AutocompleteSnippet[]
		workspaceDirs: string[]
	}> {
		// Convert filepath to URI if it's not already one
		const filepathUri = filepath.startsWith("file://") ? filepath : vscode.Uri.file(filepath).toString()

		// Initialize import definitions cache
		// this looks like a race, but the contextService only prefetches data here; it's not a mode switch.
		// This odd-looking API seems to be an optimization that's used in continue but not (currently) in our codebase,
		// continue preloads the tree-sitter parse on text editor tab switch to reduce autocomplete latency.
		await this.contextService.initializeForFile(filepathUri)

		// Create helper with URI filepath
		const helperInput = {
			...autocompleteInput,
			filepath: filepathUri,
		}

		const modelName = this.model.getModelName() ?? "codestral"
		const helper = await HelperVars.create(helperInput as any, DEFAULT_AUTOCOMPLETE_OPTS, modelName, this.ide)

		const snippetPayload = await getAllSnippetsWithoutRace({
			helper,
			ide: this.ide,
			getDefinitionsFromLsp,
			contextRetrievalService: this.contextService,
		})

		const filteredSnippets = getSnippets(helper, snippetPayload)

		// Apply access filtering to remove snippets from blocked files
		const accessibleSnippets = await this.filterSnippetsByAccess(filteredSnippets)

		// Convert all snippet filepaths to URIs
		const snippetsWithUris = accessibleSnippets.map((snippet: any) => ({
			...snippet,
			filepath: snippet.filepath?.startsWith("file://")
				? snippet.filepath
				: vscode.Uri.file(snippet.filepath).toString(),
		}))

		const workspaceDirs = await this.ide.getWorkspaceDirs()

		return { filepathUri, helper, snippetsWithUris, workspaceDirs }
	}

	/**
	 * Returns comment-based formatted context that can be added to prompts
	 */
	async getFormattedContext(autocompleteInput: AutocompleteInput, filepath: string): Promise<string> {
		const { helper, snippetsWithUris, workspaceDirs } = await this.getProcessedSnippets(autocompleteInput, filepath)

		const formattedContext = formatSnippets(helper, snippetsWithUris, workspaceDirs)

		console.log("[GhostContextProvider] - formattedContext:", formattedContext)

		return formattedContext
	}

	/**
	 * Get FIM-formatted context for codestral models
	 */
	async getFimFormattedContext(
		autocompleteInput: AutocompleteInput,
		filepath: string,
		prefix: string,
		suffix: string,
	): Promise<{ prefix: string }> {
		const { filepathUri, snippetsWithUris, workspaceDirs } = await this.getProcessedSnippets(
			autocompleteInput,
			filepath,
		)

		// Format with +++++ markers (codestral FIM format)
		return this.formatFimContext(prefix, suffix, filepathUri, snippetsWithUris, workspaceDirs)
	}

	private formatFimContext(
		prefix: string,
		suffix: string,
		filepath: string,
		snippets: AutocompleteSnippet[],
		workspaceUris: string[],
	): { prefix: string } {
		function getFileName(snippet: { uri: string; uniquePath: string }) {
			return snippet.uri.startsWith("file://") ? snippet.uniquePath : snippet.uri
		}

		if (snippets.length === 0) {
			if (suffix.trim().length === 0 && prefix.trim().length === 0) {
				return {
					prefix: `+++++ ${getLastNUriRelativePathParts(workspaceUris, filepath, 2)}\n${prefix}`,
				}
			}
			return { prefix }
		}

		const relativePaths = getShortestUniqueRelativeUriPaths(
			[
				...snippets.map((snippet) => ("filepath" in snippet ? snippet.filepath : "file:///Untitled.txt")),
				filepath,
			],
			workspaceUris,
		)

		const otherFiles = snippets
			.map((snippet, i) => {
				if (snippet.type === AutocompleteSnippetType.Diff) {
					return snippet.content
				}

				return `+++++ ${getFileName(relativePaths[i])} \n${snippet.content}`
			})
			.join("\n\n")

		return {
			prefix: `${otherFiles}\n\n+++++ ${getFileName(relativePaths[relativePaths.length - 1])}\n${prefix}`,
		}
	}
}
