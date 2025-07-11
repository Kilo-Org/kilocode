import { ToolProgressStatus } from "@roo-code/types"

import { ToolUse, DiffStrategy, DiffResult, DiffItem } from "../../../shared/tools"
import { MorphFastApplyProvider, MorphFastApplyOptions } from "../../../api/providers/morph-fast-apply"
import { normalizeString } from "../../../utils/text-normalization"

export class MorphFastApplyDiffStrategy implements DiffStrategy {
	private provider: MorphFastApplyProvider
	private maxFileSize: number
	private timeout: number

	constructor(options: MorphFastApplyOptions & { maxFileSize?: number; timeout?: number } = {}) {
		this.provider = new MorphFastApplyProvider(options)
		this.maxFileSize = options.maxFileSize || 100000 // 100KB default
		this.timeout = options.timeout || 30000 // 30 seconds default
	}

	getName(): string {
		return `MorphFastApply-${this.provider.getProviderType()}`
	}

	getToolDescription(args: { cwd: string; toolOptions?: { [key: string]: string } }): string {
		return `## morph_semantic_edit
Description: Apply semantic edits using Morph's advanced code understanding. This tool excels at understanding intent and applying changes while preserving code structure and semantics. It uses natural language instructions combined with abbreviated edit snippets for highly accurate code modifications.

Morph Fast Apply offers significant advantages:
- **4500+ tokens/second** processing speed
- **96% accuracy** in semantic understanding
- **Natural language instructions** for clarity
- **Abbreviated edit snippets** minimize token usage
- **Semantic understanding** preserves code intent

Parameters:
- path: (required) The path of the file to modify (relative to ${args.cwd})
- instruction: (required) One sentence description to disambiguate uncertainty in the edit
- edit_snippet: (required) Abbreviated edit snippet using // ... existing code ... markers

Edit Snippet Format (verbatim from Morph documentation):
"Use this tool to propose an edit to an existing file.

This will be read by a less intelligent "apply" model, which will quickly apply the edit. You should make it clear what the edit is, while also minimizing the unchanged code you write.
When writing the edit, you should specify each edit in sequence, with the special comment // ... existing code ... to represent unchanged code in between edited lines.

For example:

// ... existing code ...
FIRST_EDIT
// ... existing code ...
SECOND_EDIT
// ... existing code ...
THIRD_EDIT
// ... existing code ...

You should still bias towards repeating as few lines of the original file as possible to convey the changes.
But, each edit should contain sufficient context of unchanged lines around the code you're editing to resolve ambiguity.
DO NOT omit spans of pre-existing code (or comments) without using the // ... existing code ... comment to indicate its absence. If you omit the existing code comment, the model may inadvertently delete these lines.
If you plan on deleting a section, you must provide context before and after to delete it. If the initial code is \`code \\n Block 1 \\n Block 2 \\n Block 3 \\n code\`, and you want to remove Block 2, you would output \`// ... existing code ... \\n Block 1 \\n  Block 3 \\n // ... existing code ...\`.
Make sure it is clear what the edit should be, and where it should be applied.
ALWAYS make all edits to a file in a single edit_file instead of multiple edit_file calls to the same file. The apply model can handle many distinct edits at once."

Example:
<morph_semantic_edit>
<path>src/components/Calculator.tsx</path>
<instruction>Add 10% tax calculation to the total</instruction>
<edit_snippet>
// ... existing code ...
function calculateTotal(items) {
  // ... existing code ...
  for item in items:
    total += item.price;
  return total * 1.1;  // Add 10% tax
}
// ... existing code ...

const total, setTotal = useState(0);
useEffect(() => {
  setTotal(calculateTotal(items));
}, [items]);

// ... existing code ...
return <div>Total: {total}</div>;
</edit_snippet>
</morph_semantic_edit>

Performance: This tool processes at 4500+ tokens/second and is ideal for:
- Complex semantic edits
- Multi-function changes
- Intent-based modifications
- Large file edits (up to ${Math.floor(this.maxFileSize / 1000)}KB)

Usage Notes:
- Use descriptive instructions to clarify edit intent
- Provide sufficient context around changes
- Minimize unchanged code repetition
- Single tool call can handle multiple distinct edits`
	}

	async applyDiff(
		originalContent: string,
		diffContent: string | DiffItem[],
		_paramStartLine?: number,
		_paramEndLine?: number,
	): Promise<DiffResult> {
		try {
			// Validate file size
			if (originalContent.length > this.maxFileSize) {
				return {
					success: false,
					error: `File size (${originalContent.length} bytes) exceeds maximum supported size (${this.maxFileSize} bytes) for Morph Fast Apply. Consider using traditional diff strategies for large files.`,
				}
			}

			// Handle both string and DiffItem array formats
			let instruction: string
			let editSnippet: string

			if (typeof diffContent === 'string') {
				// Parse string format - extract instruction and edit snippet
				const parsed = this.parseStringDiffContent(diffContent)
				instruction = parsed.instruction
				editSnippet = parsed.editSnippet
			} else {
				// Handle DiffItem array format
				const parsed = this.parseDiffItemArray(diffContent)
				instruction = parsed.instruction
				editSnippet = parsed.editSnippet
			}

			// Validate required fields
			if (!instruction.trim()) {
				return {
					success: false,
					error: `Instruction is required for Morph Fast Apply. Please provide a clear, one-sentence description of the edit intent.`,
				}
			}

			if (!editSnippet.trim()) {
				return {
					success: false,
					error: `Edit snippet is required for Morph Fast Apply. Please provide the abbreviated edit content using // ... existing code ... markers.`,
				}
			}

			// Apply semantic edit using Morph
			const result = await Promise.race([
				this.provider.applySemanticEdit(instruction, originalContent, editSnippet),
				new Promise<never>((_, reject) => 
					setTimeout(() => reject(new Error(`Morph Fast Apply timed out after ${this.timeout}ms`)), this.timeout)
				)
			])

			// Validate result
			if (!result || typeof result !== 'string') {
				return {
					success: false,
					error: `Morph Fast Apply returned invalid result. Expected string content, received: ${typeof result}`,
				}
			}

			// Basic validation - ensure result has content
			if (result.trim().length === 0) {
				return {
					success: false,
					error: `Morph Fast Apply returned empty result. The edit may have failed or the content was completely removed.`,
				}
			}

			// Success - return the merged content
			return {
				success: true,
				content: result,
			}

		} catch (error) {
			return {
				success: false,
				error: `Morph Fast Apply failed: ${error instanceof Error ? error.message : String(error)}`,
				details: {
					provider: this.provider.getProviderType(),
					originalSize: originalContent.length,
					timeout: this.timeout,
				}
			}
		}
	}

	private parseStringDiffContent(content: string): { instruction: string; editSnippet: string } {
		// Try to extract instruction and edit snippet from various formats
		
		// Format 1: XML-style tags
		const xmlInstructionMatch = content.match(/<instruction>(.*?)<\/instruction>/s)
		const xmlEditMatch = content.match(/<edit_snippet>(.*?)<\/edit_snippet>/s)
		
		if (xmlInstructionMatch && xmlEditMatch) {
			return {
				instruction: xmlInstructionMatch[1].trim(),
				editSnippet: xmlEditMatch[1].trim()
			}
		}

		// Format 2: Markdown-style sections
		const sections = content.split(/(?:^|\n)##?\s*(?:instruction|edit[_\s]snippet)/i)
		if (sections.length >= 3) {
			return {
				instruction: sections[1].trim(),
				editSnippet: sections[2].trim()
			}
		}

		// Format 3: Simple two-part split (instruction first, then edit)
		const parts = content.split(/\n\s*---+\s*\n|\n\s*===+\s*\n/)
		if (parts.length >= 2) {
			return {
				instruction: parts[0].trim(),
				editSnippet: parts.slice(1).join('\n').trim()
			}
		}

		// Fallback: use first line as instruction, rest as edit snippet
		const lines = content.split('\n')
		const instruction = lines[0] || 'Apply semantic edit'
		const editSnippet = lines.slice(1).join('\n').trim() || content

		return { instruction, editSnippet }
	}

	private parseDiffItemArray(items: DiffItem[]): { instruction: string; editSnippet: string } {
		// For DiffItem array, combine all content into a single edit snippet
		// Use the first item's content as potential instruction if it looks like one
		
		if (items.length === 0) {
			return { instruction: 'Apply semantic edit', editSnippet: '' }
		}

		// If first item looks like an instruction (short, no code patterns)
		const firstItem = items[0]
		const firstContent = firstItem.content.trim()
		
		if (firstContent.length < 200 && 
			!firstContent.includes('function') && 
			!firstContent.includes('class') &&
			!firstContent.includes('const') &&
			!firstContent.includes('let') &&
			!firstContent.includes('var') &&
			!firstContent.includes('{') &&
			!firstContent.includes('}') &&
			items.length > 1) {
			
			// Use first item as instruction, rest as edit snippet
			const instruction = firstContent
			const editSnippet = items.slice(1).map(item => item.content).join('\n\n')
			return { instruction, editSnippet }
		}

		// Otherwise, combine all as edit snippet with default instruction
		const editSnippet = items.map(item => item.content).join('\n\n')
		return { instruction: 'Apply semantic edit', editSnippet }
	}

	getProgressStatus(toolUse: ToolUse, result?: DiffResult): ToolProgressStatus {
		if (!result) {
			return {
				message: "Preparing semantic edit with Morph Fast Apply...",
				detail: "Processing edit instruction and snippet"
			}
		}

		if (result.success) {
			return {
				message: "✓ Semantic edit applied successfully",
				detail: `Morph Fast Apply processed edit in ${this.provider.getProviderType()} mode`
			}
		} else {
			return {
				message: "✗ Semantic edit failed",
				detail: result.error || "Unknown error occurred"
			}
		}
	}

	/**
	 * Check if this strategy is available (provider is properly configured)
	 */
	async isAvailable(): Promise<boolean> {
		try {
			return this.provider.supportsSemanticApply()
		} catch {
			return false
		}
	}

	/**
	 * Get the provider instance for advanced usage
	 */
	getProvider(): MorphFastApplyProvider {
		return this.provider
	}
} 