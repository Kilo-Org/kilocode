import type { BenchmarkTestCase } from "../types/BenchmarkTypes"

// Simplified mock workspace builder for benchmarking
// This creates the mock environment needed for Ghost testing

export interface MockWorkspace {
	activeDocument: any
	allDocuments: { [filename: string]: any }
	cursorPosition: { line: number; character: number }
}

/**
 * Creates mock workspace environment for benchmark testing
 * Simplified version that focuses on what benchmarking needs
 */
export class MockWorkspaceBuilder {
	/**
	 * Build mock workspace from test case
	 */
	buildWorkspace(testCase: BenchmarkTestCase): MockWorkspace {
		// For now, create a simple structure
		// This will be enhanced as we integrate with the Ghost system

		const activeDocument = {
			uri: { fsPath: testCase.activeFile, toString: () => testCase.activeFile },
			fileName: testCase.activeFile,
			getText: () => testCase.inputContent,
			lineAt: (lineNumber: number) => {
				const lines = testCase.inputContent.split("\n")
				return {
					text: lines[lineNumber] || "",
					lineNumber,
				}
			},
		}

		const allDocuments: { [filename: string]: any } = {}
		for (const [filename, content] of Object.entries(testCase.inputFiles)) {
			allDocuments[filename] = {
				uri: { fsPath: filename, toString: () => filename },
				fileName: filename,
				getText: () => content,
				lineAt: (lineNumber: number) => {
					const lines = content.split("\n")
					return {
						text: lines[lineNumber] || "",
						lineNumber,
					}
				},
			}
		}

		return {
			activeDocument,
			allDocuments,
			cursorPosition: testCase.cursorPosition,
		}
	}

	/**
	 * Create Ghost suggestion context from mock workspace
	 */
	createSuggestionContext(workspace: MockWorkspace): any {
		// Simple context for testing
		return {
			document: workspace.activeDocument,
			range: {
				start: workspace.cursorPosition,
				end: workspace.cursorPosition,
			},
			diagnostics: [],
		}
	}
}
