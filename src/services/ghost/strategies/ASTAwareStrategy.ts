import { GhostSuggestionContext } from "../types"
import { BasePromptStrategy } from "./BasePromptStrategy"
import { UseCaseType } from "../types/PromptStrategy"
import { CURSOR_MARKER } from "../ghostConstants"

/**
 * Strategy for AST-aware completions
 * Lower priority, provides context-aware completions based on AST
 */
export class ASTAwareStrategy extends BasePromptStrategy {
	name = "AST Aware"
	type = UseCaseType.AST_AWARE

	canHandle(context: GhostSuggestionContext): boolean {
		// This strategy requires AST information to be useful
		return !!(
			context.documentAST &&
			context.rangeASTNode &&
			!context.userInput &&
			!context.diagnostics?.length // Let error fix strategy handle errors
		)
	}

	getRelevantContext(context: GhostSuggestionContext): Partial<GhostSuggestionContext> {
		return {
			document: context.document,
			range: context.range,
			documentAST: context.documentAST,
			rangeASTNode: context.rangeASTNode,
			recentOperations: context.recentOperations,
		}
	}

	protected getSpecificSystemInstructions(): string {
		return `You are an expert code completion assistant that uses Abstract Syntax Tree (AST) information to provide intelligent completions.

## Core Responsibilities:
1. Analyze the current AST node context
2. Understand the syntactic structure around the cursor
3. Provide completions that fit the AST structure
4. Ensure syntactic and semantic correctness
5. Complete based on language grammar rules

## AST Analysis Guidelines:
- Identify the current node type and its parent
- Understand what child nodes are expected
- Consider the node's position in the tree
- Analyze sibling nodes for patterns
- Respect language-specific AST structures

## Completion Strategies by Node Type:
- **Function/Method Nodes**: Complete parameters, return types, or body
- **Class Nodes**: Add methods, properties, or constructors
- **Statement Nodes**: Complete expressions or control flow
- **Expression Nodes**: Finish operators, operands, or calls
- **Declaration Nodes**: Complete type annotations or initializers
- **Block Nodes**: Add appropriate statements

## Context Awareness:
- Use parent node to understand scope
- Check sibling nodes for patterns
- Consider the depth in the AST
- Analyze incomplete nodes
- Respect language grammar rules

## Output Requirements:
- Generate syntactically valid completions
- Ensure AST consistency
- Match the expected node type
- Maintain proper nesting
- Follow language-specific patterns`
	}

	protected buildUserPrompt(context: Partial<GhostSuggestionContext>): string {
		if (!context.document || !context.range || !context.rangeASTNode) {
			return "No AST context available for completion."
		}

		const document = context.document
		const astNode = context.rangeASTNode
		const currentLine = document.lineAt(context.range.start.line).text

		// Get AST information
		const nodeInfo = this.extractNodeInfo(astNode)
		const expectedChildren = this.getExpectedChildren(astNode)
		const siblingPatterns = this.analyzeSiblings(astNode)

		let prompt = `## AST Context\n`
		prompt += `- Language: ${document.languageId}\n`
		prompt += `- Current Line: ${currentLine}\n\n`

		prompt += `### AST Information\n`
		prompt += `- Current Node: \`${nodeInfo.type}\`\n`
		prompt += `- Text: \`${nodeInfo.text}\`\n`
		prompt += `- Is Complete: ${nodeInfo.isComplete}\n`

		if (nodeInfo.parent) {
			prompt += `- Parent Node: \`${nodeInfo.parent.type}\`\n`
			prompt += `- Parent Child Count: ${nodeInfo.parent.childCount}\n`
		}

		if (expectedChildren.length > 0) {
			prompt += `- Expected Children: ${expectedChildren.join(", ")}\n`
		}

		if (siblingPatterns.length > 0) {
			prompt += `- Sibling Patterns:\n`
			siblingPatterns.forEach((pattern) => {
				prompt += `  - ${pattern}\n`
			})
		}

		prompt += `- Nesting Level: ${nodeInfo.nestingLevel}\n\n`

		// Add the full document with cursor marker
		if (context.document) {
			prompt += "## Full Code\n"
			prompt += this.formatDocumentWithCursor(context.document, context.range)
			prompt += "\n\n"
		}

		prompt += `## Instructions\n`
		prompt += `Based on the AST context, complete the code at the cursor position (${CURSOR_MARKER}).\n`
		prompt += `The completion should fit the expected AST structure for a ${nodeInfo.type} node.\n`

		return prompt
	}

	/**
	 * Extracts information about the current AST node
	 */
	private extractNodeInfo(node: any): any {
		const info: any = {
			type: node.type || "unknown",
			text: node.text ? node.text.substring(0, 100) : "",
			isComplete: !node.isMissing && !node.hasError,
			nestingLevel: 0,
		}

		// Calculate nesting level
		let current = node
		while (current.parent) {
			info.nestingLevel++
			current = current.parent
		}

		// Get parent info
		if (node.parent) {
			info.parent = {
				type: node.parent.type,
				childCount: node.parent.childCount || 0,
			}
		}

		return info
	}

	/**
	 * Determines expected child nodes based on node type
	 */
	private getExpectedChildren(node: any): string[] {
		const nodeType = node.type
		const expected: string[] = []

		// Common patterns across languages
		// This is simplified - real implementation would be language-specific
		switch (nodeType) {
			case "function_declaration":
			case "method_definition":
				expected.push("identifier", "parameters", "block")
				break
			case "class_declaration":
			case "class_definition":
				expected.push("identifier", "class_body")
				break
			case "if_statement":
				expected.push("condition", "then_branch", "else_branch")
				break
			case "for_statement":
				expected.push("init", "condition", "update", "body")
				break
			case "while_statement":
				expected.push("condition", "body")
				break
			case "variable_declaration":
				expected.push("identifier", "type", "initializer")
				break
			case "call_expression":
				expected.push("function", "arguments")
				break
			case "binary_expression":
				expected.push("left", "operator", "right")
				break
			case "block":
			case "statement_block":
				expected.push("statement")
				break
		}

		// Filter out already present children
		if (node.children) {
			const existingTypes = node.children.map((c: any) => c.type)
			return expected.filter((type) => !existingTypes.includes(type))
		}

		return expected
	}

	/**
	 * Analyzes sibling nodes to find patterns
	 */
	private analyzeSiblings(node: any): string[] {
		const patterns: string[] = []

		if (!node.parent || !node.parent.children) {
			return patterns
		}

		const siblings = node.parent.children
		const nodeIndex = siblings.indexOf(node)

		// Look at previous siblings for patterns
		if (nodeIndex > 0) {
			const prevSibling = siblings[nodeIndex - 1]
			if (prevSibling.type === node.type) {
				patterns.push(`Repeated ${node.type} pattern detected`)
			}

			// Check for common sequences
			if (prevSibling.type === "comment" && node.type === "function_declaration") {
				patterns.push("Comment followed by function pattern")
			}

			if (prevSibling.type === "decorator" && node.type === "function_declaration") {
				patterns.push("Decorator pattern detected")
			}
		}

		// Check for list patterns (multiple similar siblings)
		const sameTypeSiblings = siblings.filter((s: any) => s.type === node.type)
		if (sameTypeSiblings.length > 2) {
			patterns.push(`List of ${node.type} elements`)
		}

		// Check for incomplete patterns
		const incompleteSiblings = siblings.filter((s: any) => s.isMissing || s.hasError)
		if (incompleteSiblings.length > 0) {
			patterns.push("Incomplete sibling nodes present")
		}

		return patterns
	}
}
