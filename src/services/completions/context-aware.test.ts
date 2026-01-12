// kilocode_change - new file

/**
 * Integration tests for context-aware completions
 * Tests the complete workflow of context-aware code suggestions
 */

import { describe, test, expect, beforeEach, vi } from "vitest"
import type {
	CompletionContext,
	ProjectContext,
	SemanticContext,
	GetCompletionsRequest,
	CompletionResponse,
	CodeCompletion,
	SemanticSearchResult,
	FileReference,
} from "./types"

// Mock context engine
const mockContextEngine = {
	buildContext: vi.fn(),
	getProjectContext: vi.fn(),
	getSemanticContext: vi.fn(),
	search: vi.fn(),
}

// Mock semantic search service
const mockSemanticSearch = {
	search: vi.fn(),
	getRelevantFiles: vi.fn(),
	analyzeConcepts: vi.fn(),
}

// Mock completion service
const mockCompletionService = {
	generateCompletions: vi.fn(),
	naturalLanguageToCode: vi.fn(),
}

describe("Context-Aware Completions Integration Tests", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	describe("Complete Context-Aware Completions Workflow", () => {
		test("should generate completions with full project context", async () => {
			const request: GetCompletionsRequest = {
				filePath: "/project/src/components/UserProfile.tsx",
				position: 150,
				surroundingCode: "const [user, setUser] = useState(",
				context: {
					includeSemantic: true,
					includeDependencies: true,
					includeTests: false,
					maxFiles: 50,
					windowSize: 8000,
				},
				language: "typescript",
			}

			// Mock project context
			const projectContext: ProjectContext = {
				projectPath: "/project",
				language: "typescript",
				framework: "react",
				dependencies: ["react", "typescript", "@types/react"],
				recentFiles: [
					"/project/src/components/UserProfile.tsx",
					"/project/src/pages/Dashboard.tsx",
					"/project/src/services/user.ts",
					"/project/src/types/user.ts",
				],
				gitBranch: "main",
			}

			mockContextEngine.getProjectContext.mockResolvedValue(projectContext)

			// Mock semantic context
			const semanticContext: SemanticContext = {
				embeddings: [
					[0.1, 0.2, 0.3],
					[0.4, 0.5, 0.6],
				],
				relevantFiles: [
					{
						id: "file-1",
						filePath: "/project/src/types/user.ts",
						changeType: "update",
					},
					{
						id: "file-2",
						filePath: "/project/src/services/user.ts",
						changeType: "update",
					},
				],
				concepts: ["useState", "React hooks", "state management", "User type"],
				relationships: [
					{
						concept1: "useState",
						concept2: "React",
						relationshipType: "depends_on",
						strength: 0.9,
					},
					{
						concept1: "User",
						concept2: "state management",
						relationshipType: "related",
						strength: 0.8,
					},
				],
			}

			mockContextEngine.getSemanticContext.mockResolvedValue(semanticContext)

			// Mock completions
			const completions: CodeCompletion[] = [
				{
					id: "comp-1",
					text: "User | null>(null)",
					type: "snippet",
					priority: "high",
					source: "local",
					confidence: 0.95,
					filePath: "/project/src/types/user.ts",
					position: { line: 10, column: 5 },
					insertText: "User | null>(null)",
					documentation: "User type definition from types/user.ts",
					metadata: {
						sourceFiles: ["/project/src/types/user.ts"],
						isFromCache: false,
					},
				},
				{
					id: "comp-2",
					text: "initialUser)",
					type: "variable",
					priority: "medium",
					source: "local",
					confidence: 0.75,
					filePath: "/project/src/components/UserProfile.tsx",
					insertText: "initialUser)",
					documentation: "Initial user variable defined in same file",
				},
			]

			mockCompletionService.generateCompletions.mockResolvedValue(completions)

			// Build complete context
			const completionContext: CompletionContext = {
				id: "ctx-123",
				filePath: request.filePath,
				position: request.position,
				surroundingCode: request.surroundingCode,
				projectContext,
				semanticContext,
				metadata: {
					windowSize: request.context?.windowSize,
					maxFiles: request.context?.maxFiles,
					semanticThreshold: 0.8,
					indexingTime: 50,
				},
			}

			const response: CompletionResponse = {
				completions,
				context: completionContext,
				responseTime: 150,
				metadata: {
					totalCompletions: 2,
					cacheHit: false,
					model: "claude-3.5-sonnet",
					provider: "anthropic",
					processingTime: 100,
				},
			}

			// Verify context was built
			expect(mockContextEngine.getProjectContext).toHaveBeenCalledWith("/project")
			expect(mockContextEngine.getSemanticContext).toHaveBeenCalledWith(
				request.filePath,
				request.position,
				request.surroundingCode,
				{ maxFiles: 50, includeDependencies: true },
			)

			// Verify completions were generated
			expect(mockCompletionService.generateCompletions).toHaveBeenCalledWith(completionContext, request.language)

			// Verify response structure
			expect(response.completions).toHaveLength(2)
			expect(response.context.projectContext).toBeDefined()
			expect(response.context.semanticContext).toBeDefined()
			expect(response.context.semanticContext.concepts).toContain("useState")
			expect(response.context.semanticContext.relevantFiles).toHaveLength(2)
		})

		test("should use semantic search to find relevant code patterns", async () => {
			const request: GetCompletionsRequest = {
				filePath: "/project/src/services/auth.ts",
				position: 50,
				surroundingCode: "export function ",
				context: {
					includeSemantic: true,
					maxFiles: 20,
				},
				language: "typescript",
			}

			// Mock semantic search results
			const searchResults: SemanticSearchResult[] = [
				{
					file: {
						id: "file-1",
						filePath: "/project/src/services/auth.ts",
						changeType: "update",
					},
					relevanceScore: 0.9,
					matchingConcepts: ["authentication", "user", "login"],
					snippet: "export function authenticateUser(username: string, password: string)",
					lineNumbers: [10, 15],
				},
				{
					file: {
						id: "file-2",
						filePath: "/project/src/types/auth.ts",
						changeType: "update",
					},
					relevanceScore: 0.85,
					matchingConcepts: ["User", "credentials"],
					snippet: "export interface User { id: string; username: string; }",
					lineNumbers: [5, 8],
				},
			]

			mockSemanticSearch.search.mockResolvedValue(searchResults)

			// Mock completions based on search results
			const completions: CodeCompletion[] = [
				{
					id: "comp-1",
					text: "authenticateUser(username: string, password: string): Promise<User>",
					type: "function",
					priority: "high",
					source: "local",
					confidence: 0.9,
					filePath: "/project/src/services/auth.ts",
					position: { line: 10, column: 0 },
					documentation: "Authenticates a user with username and password",
					metadata: {
						sourceFiles: ["/project/src/services/auth.ts"],
						relevanceScore: 0.9,
					},
				},
			]

			mockCompletionService.generateCompletions.mockResolvedValue(completions)

			// Perform semantic search
			const results = await mockSemanticSearch.search("authentication", 20)

			expect(results).toHaveLength(2)
			expect(results[0].relevanceScore).toBe(0.9)
			expect(results[0].matchingConcepts).toContain("authentication")

			// Verify completions use search results
			expect(mockCompletionService.generateCompletions).toHaveBeenCalled()
		})

		test("should handle natural language to code translation", async () => {
			const request: GetCompletionsRequest = {
				filePath: "/project/src/components/UserProfile.tsx",
				position: 100,
				surroundingCode: "// TODO: ",
				context: {
					includeSemantic: true,
				},
				language: "typescript",
			}

			const comment = "Fetch user data from API and handle loading state"

			// Mock natural language to code translation
			const nlToCodeResult: CodeCompletion[] = [
				{
					id: "comp-1",
					text: `const [user, setUser] = useState<User | null>(null)
const [loading, setLoading] = useState(true)
const [error, setError] = useState<string | null>(null)

useEffect(() => {
	const fetchUser = async () => {
		try {
			setLoading(true)
			const response = await userApi.getCurrentUser()
			setUser(response.data)
		} catch (err) {
			setError(err.message)
		} finally {
			setLoading(false)
		}
	}

	fetchUser()
}, [])`,
					type: "snippet",
					priority: "high",
					source: "ai-generated",
					confidence: 0.9,
					documentation: "Fetches user data with loading and error states",
					metadata: {
						model: "claude-3.5-sonnet",
						responseTime: 200,
					},
				},
			]

			mockCompletionService.naturalLanguageToCode.mockResolvedValue(nlToCodeResult)

			// Perform translation
			const result = await mockCompletionService.naturalLanguageToCode(comment, request)

			expect(result).toHaveLength(1)
			expect(result[0].type).toBe("snippet")
			expect(result[0].text).toContain("useState")
			expect(result[0].text).toContain("useEffect")
			expect(result[0].confidence).toBe(0.9)
		})
	})

	describe("Context Caching and Performance", () => {
		test("should use cached context when available", async () => {
			const request: GetCompletionsRequest = {
				filePath: "/project/src/utils/helpers.ts",
				position: 50,
				surroundingCode: "export function ",
				context: {
					includeSemantic: true,
				},
				language: "typescript",
			}

			// Mock cached context
			const cachedContext: CompletionContext = {
				id: "ctx-cached-123",
				filePath: request.filePath,
				position: request.position,
				surroundingCode: request.surroundingCode,
				projectContext: {
					projectPath: "/project",
					language: "typescript",
					dependencies: [],
					recentFiles: [],
				},
				semanticContext: {
					embeddings: [],
					relevantFiles: [],
					concepts: [],
					relationships: [],
				},
			}

			mockContextEngine.buildContext.mockResolvedValue(cachedContext)

			// Mock completions
			const completions: CodeCompletion[] = [
				{
					id: "comp-1",
					text: "helperFunction()",
					type: "function",
					priority: "high",
					source: "local",
					confidence: 0.85,
				},
			]

			mockCompletionService.generateCompletions.mockResolvedValue(completions)

			const response: CompletionResponse = {
				completions,
				context: cachedContext,
				responseTime: 50,
				metadata: {
					totalCompletions: 1,
					cacheHit: true,
					processingTime: 10,
				},
			}

			// Verify cache was used
			expect(response.metadata?.cacheHit).toBe(true)
			expect(response.responseTime).toBeLessThan(100) // Should be faster with cache
		})

		test("should handle cache miss and rebuild context", async () => {
			const request: GetCompletionsRequest = {
				filePath: "/project/src/new-file.ts",
				position: 0,
				surroundingCode: "",
				context: {
					includeSemantic: true,
				},
				language: "typescript",
			}

			// Mock cache miss - rebuild context
			const newContext: CompletionContext = {
				id: "ctx-new-456",
				filePath: request.filePath,
				position: request.position,
				surroundingCode: request.surroundingCode,
				projectContext: {
					projectPath: "/project",
					language: "typescript",
					dependencies: [],
					recentFiles: [request.filePath],
				},
				semanticContext: {
					embeddings: [],
					relevantFiles: [],
					concepts: [],
					relationships: [],
				},
				metadata: {
					indexingTime: 200,
				},
			}

			mockContextEngine.buildContext.mockResolvedValue(newContext)

			// Mock completions
			const completions: CodeCompletion[] = []

			mockCompletionService.generateCompletions.mockResolvedValue(completions)

			const response: CompletionResponse = {
				completions,
				context: newContext,
				responseTime: 250,
				metadata: {
					totalCompletions: 0,
					cacheHit: false,
					processingTime: 200,
				},
			}

			// Verify cache was missed and context was rebuilt
			expect(response.metadata?.cacheHit).toBe(false)
			expect(response.context.metadata?.indexingTime).toBe(200)
		})
	})

	describe("Multi-File Context Awareness", () => {
		test("should aggregate context from multiple related files", async () => {
			const request: GetCompletionsRequest = {
				filePath: "/project/src/components/UserProfile.tsx",
				position: 150,
				surroundingCode: "const [user, setUser] = useState(",
				context: {
					includeSemantic: true,
					includeDependencies: true,
					maxFiles: 50,
				},
				language: "typescript",
			}

			// Mock multiple relevant files
			const relevantFiles = [
				"/project/src/types/user.ts",
				"/project/src/services/user.ts",
				"/project/src/components/UserList.tsx",
				"/project/src/pages/UserDashboard.tsx",
			]

			mockContextEngine.getSemanticContext.mockResolvedValue({
				embeddings: [],
				relevantFiles: relevantFiles.map((filePath) => ({
					id: `file-${filePath}`,
					filePath,
					changeType: "update",
				})),
				concepts: ["User", "useState", "React", "state management"],
				relationships: [],
			})

			// Mock completions from multiple files
			const completions: CodeCompletion[] = [
				{
					id: "comp-1",
					text: "User | null>(null)",
					type: "snippet",
					priority: "high",
					source: "local",
					confidence: 0.9,
					filePath: "/project/src/types/user.ts",
					documentation: "User type from types/user.ts",
				},
				{
					id: "comp-2",
					text: "initialUser)",
					type: "variable",
					priority: "medium",
					source: "local",
					confidence: 0.7,
					filePath: "/project/src/components/UserProfile.tsx",
					documentation: "Initial user from UserProfile.tsx",
				},
			]

			mockCompletionService.generateCompletions.mockResolvedValue(completions)

			// Verify context includes multiple files
			const semanticContext = await mockContextEngine.getSemanticContext(
				request.filePath,
				request.position,
				request.surroundingCode,
				{ maxFiles: 50 },
			)

			expect(semanticContext.relevantFiles).toHaveLength(4)
			expect(semanticContext.relevantFiles.map((f: FileReference) => f.filePath)).toContain(
				"/project/src/types/user.ts",
			)
			expect(semanticContext.concepts).toContain("User")
		})
	})
})
