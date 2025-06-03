import {
	AutocompleteSnippetType,
	type AutocompleteContextSnippet,
	type AutocompleteCodeSnippet,
} from "../templating/snippetTypes"
import { CodeContextDefinition } from "../ContextGatherer"
import { getUriPathBasename } from "../templating/uri"

export const generateImportSnippets = (
	includeImports: boolean,
	imports: string[],
	currentFilepath: string,
): AutocompleteContextSnippet[] =>
	(includeImports ? imports : []).map((importStatement, index) => ({
		type: AutocompleteSnippetType.Context,
		content: importStatement,
		filepath: `context://imports/${getUriPathBasename(currentFilepath)}#${index}`,
	}))

export const generateDefinitionSnippets = (
	includeDefinitions: boolean,
	definitions: CodeContextDefinition[],
): AutocompleteCodeSnippet[] =>
	(includeDefinitions ? definitions : []).map((def) => ({
		type: AutocompleteSnippetType.Code,
		filepath: def.filepath,
		content: def.content,
		// language: def.language // Language is not on CodeContextDefinition, derived from main file or filepath extension if needed by template
	}))
