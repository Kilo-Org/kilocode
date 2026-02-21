// npx vitest run src/components/chat/__tests__/ReviewScopeSelector.spec.tsx

import { render, screen, fireEvent } from "@/utils/test-utils"
import { vi } from "vitest"
import { ReviewScopeSelector, type ReviewScopeInfo } from "../ReviewScopeSelector"

// Mock vscode postMessage
const mockPostMessage = vi.fn()
vi.mock("@src/utils/vscode", () => ({
	vscode: {
		postMessage: (message: unknown) => mockPostMessage(message),
	},
}))

// Mock react-i18next
vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string, defaultValue?: string | Record<string, unknown>, options?: Record<string, unknown>) => {
			// Handle i18next interpolation
			if (typeof defaultValue === "object" && defaultValue !== null && !("count" in defaultValue)) {
				options = defaultValue as Record<string, unknown>
				defaultValue = key
			}
			let result = defaultValue || key
			if (typeof result === "string" && options) {
				Object.entries(options).forEach(([k, v]) => {
					result = (result as string).replace(`{{${k}}}`, String(v))
				})
			}
			return result
		},
	}),
}))

describe("ReviewScopeSelector", () => {
	const baseScopeInfo: ReviewScopeInfo = {
		uncommitted: {
			available: true,
			fileCount: 3,
			filePreview: ["src/file1.ts", "src/file2.ts", "src/file3.ts"],
		},
		branch: {
			available: true,
			currentBranch: "feature/test",
			baseBranch: "main",
			fileCount: 5,
			filePreview: ["src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts", "src/e.ts"],
		},
	}

	const defaultProps = {
		open: true,
		onOpenChange: vi.fn(),
		scopeInfo: baseScopeInfo,
	}

	beforeEach(() => {
		vi.clearAllMocks()
	})

	describe("Basic Rendering", () => {
		it("renders dialog when open", () => {
			render(<ReviewScopeSelector {...defaultProps} />)

			expect(screen.getByText("Select Review Scope")).toBeInTheDocument()
			expect(screen.getByText("Uncommitted changes")).toBeInTheDocument()
			expect(screen.getByText("Branch diff")).toBeInTheDocument()
		})

		it("does not render when open is false", () => {
			render(<ReviewScopeSelector {...defaultProps} open={false} />)

			expect(screen.queryByText("Select Review Scope")).not.toBeInTheDocument()
		})

		it("shows file counts for both options", () => {
			render(<ReviewScopeSelector {...defaultProps} />)

			expect(screen.getByText("3 file(s) changed")).toBeInTheDocument()
			expect(screen.getByText("feature/test vs main (5 file(s))")).toBeInTheDocument()
		})

		it("shows file preview for uncommitted changes", () => {
			render(<ReviewScopeSelector {...defaultProps} />)

			expect(screen.getByText("src/file1.ts")).toBeInTheDocument()
			expect(screen.getByText("src/file2.ts")).toBeInTheDocument()
			expect(screen.getByText("src/file3.ts")).toBeInTheDocument()
		})

		it("shows file preview for branch diff with more indicator", () => {
			render(<ReviewScopeSelector {...defaultProps} />)

			expect(screen.getByText("src/a.ts")).toBeInTheDocument()
			expect(screen.getByText("src/b.ts")).toBeInTheDocument()
			expect(screen.getByText("src/c.ts")).toBeInTheDocument()
			expect(screen.getByText("+2 more")).toBeInTheDocument()
		})
	})

	describe("Option Availability", () => {
		it("disables uncommitted option when not available", () => {
			const scopeInfo: ReviewScopeInfo = {
				...baseScopeInfo,
				uncommitted: { available: false, fileCount: 0 },
			}
			render(<ReviewScopeSelector {...defaultProps} scopeInfo={scopeInfo} />)

			const uncommittedRadio = screen.getByRole("radio", { name: /uncommitted/i })
			expect(uncommittedRadio).toBeDisabled()
			expect(screen.getByText("No uncommitted changes")).toBeInTheDocument()
		})

		it("disables branch option when not available", () => {
			const scopeInfo: ReviewScopeInfo = {
				...baseScopeInfo,
				branch: {
					available: false,
					currentBranch: "main",
					baseBranch: "main",
					fileCount: 0,
				},
			}
			render(<ReviewScopeSelector {...defaultProps} scopeInfo={scopeInfo} />)

			const branchRadio = screen.getByRole("radio", { name: /branch/i })
			expect(branchRadio).toBeDisabled()
			expect(screen.getByText("Already on base branch or no changes")).toBeInTheDocument()
		})

		it("shows error when provided", () => {
			const scopeInfo: ReviewScopeInfo = {
				...baseScopeInfo,
				error: "Failed to detect git repository",
			}
			render(<ReviewScopeSelector {...defaultProps} scopeInfo={scopeInfo} />)

			expect(screen.getByText("Failed to detect git repository")).toBeInTheDocument()
		})

		it("shows nothing to review message when both options unavailable", () => {
			const scopeInfo: ReviewScopeInfo = {
				uncommitted: { available: false, fileCount: 0 },
				branch: {
					available: false,
					currentBranch: "main",
					baseBranch: "main",
					fileCount: 0,
				},
			}
			render(<ReviewScopeSelector {...defaultProps} scopeInfo={scopeInfo} />)

			expect(screen.getByText("No changes found to review")).toBeInTheDocument()
		})
	})

	describe("User Interactions", () => {
		it("selects uncommitted by default", () => {
			render(<ReviewScopeSelector {...defaultProps} />)

			const uncommittedRadio = screen.getByRole("radio", { name: /uncommitted/i })
			expect(uncommittedRadio).toBeChecked()
		})

		it("allows selecting branch diff", () => {
			render(<ReviewScopeSelector {...defaultProps} />)

			const branchRadio = screen.getByRole("radio", { name: /branch/i })
			fireEvent.click(branchRadio)

			expect(branchRadio).toBeChecked()
		})

		it("sends correct message when starting uncommitted review", () => {
			render(<ReviewScopeSelector {...defaultProps} />)

			fireEvent.click(screen.getByText("Start Review"))

			expect(mockPostMessage).toHaveBeenCalledWith({
				type: "reviewScopeSelected",
				reviewScope: "uncommitted",
			})
		})

		it("sends correct message when starting branch review", () => {
			render(<ReviewScopeSelector {...defaultProps} />)

			const branchRadio = screen.getByRole("radio", { name: /branch/i })
			fireEvent.click(branchRadio)
			fireEvent.click(screen.getByText("Start Review"))

			expect(mockPostMessage).toHaveBeenCalledWith({
				type: "reviewScopeSelected",
				reviewScope: "branch",
			})
		})

		it("closes dialog when cancel is clicked", () => {
			const onOpenChange = vi.fn()
			render(<ReviewScopeSelector {...defaultProps} onOpenChange={onOpenChange} />)

			fireEvent.click(screen.getByText("Cancel"))

			expect(onOpenChange).toHaveBeenCalledWith(false)
		})

		it("closes dialog after starting review", () => {
			const onOpenChange = vi.fn()
			render(<ReviewScopeSelector {...defaultProps} onOpenChange={onOpenChange} />)

			fireEvent.click(screen.getByText("Start Review"))

			expect(onOpenChange).toHaveBeenCalledWith(false)
		})

		it("disables start review button when nothing to review", () => {
			const scopeInfo: ReviewScopeInfo = {
				uncommitted: { available: false, fileCount: 0 },
				branch: {
					available: false,
					currentBranch: "main",
					baseBranch: "main",
					fileCount: 0,
				},
			}
			render(<ReviewScopeSelector {...defaultProps} scopeInfo={scopeInfo} />)

			const startButton = screen.getByText("Start Review")
			expect(startButton).toBeDisabled()
		})
	})

	describe("Auto-selection", () => {
		it("auto-selects branch when uncommitted is not available", () => {
			const scopeInfo: ReviewScopeInfo = {
				uncommitted: { available: false, fileCount: 0 },
				branch: {
					available: true,
					currentBranch: "feature/test",
					baseBranch: "main",
					fileCount: 5,
				},
			}
			render(<ReviewScopeSelector {...defaultProps} scopeInfo={scopeInfo} />)

			const branchRadio = screen.getByRole("radio", { name: /branch/i })
			expect(branchRadio).toBeChecked()
		})

		it("sends branch scope even with default uncommitted when branch is only option", () => {
			// This test verifies the bug fix where effectiveScope should be used instead of selectedScope
			// When uncommitted is unavailable and branch is available, the dialog auto-selects branch
			// and should send "branch" even though the initial selectedScope state is "uncommitted"
			const scopeInfo: ReviewScopeInfo = {
				uncommitted: { available: false, fileCount: 0 },
				branch: {
					available: true,
					currentBranch: "feature/test",
					baseBranch: "main",
					fileCount: 5,
				},
			}
			render(<ReviewScopeSelector {...defaultProps} scopeInfo={scopeInfo} />)

			// Immediately click Start Review without manually selecting anything
			fireEvent.click(screen.getByText("Start Review"))

			// Should send "branch" due to auto-selection (effectiveScope), not "uncommitted" (selectedScope)
			expect(mockPostMessage).toHaveBeenCalledWith({
				type: "reviewScopeSelected",
				reviewScope: "branch",
			})
		})

		it("sends uncommitted scope when branch is unavailable and auto-selected", () => {
			// This tests the reverse scenario - when only uncommitted is available
			const scopeInfo: ReviewScopeInfo = {
				uncommitted: { available: true, fileCount: 3 },
				branch: {
					available: false,
					currentBranch: "main",
					baseBranch: "main",
					fileCount: 0,
				},
			}
			render(<ReviewScopeSelector {...defaultProps} scopeInfo={scopeInfo} />)

			// Uncommitted should be auto-selected and checked
			const uncommittedRadio = screen.getByRole("radio", { name: /uncommitted/i })
			expect(uncommittedRadio).toBeChecked()

			fireEvent.click(screen.getByText("Start Review"))

			expect(mockPostMessage).toHaveBeenCalledWith({
				type: "reviewScopeSelected",
				reviewScope: "uncommitted",
			})
		})
	})

	describe("Null scopeInfo handling", () => {
		it("shows loading state when scopeInfo is null", () => {
			render(<ReviewScopeSelector {...defaultProps} scopeInfo={null} />)

			expect(screen.getByText("Select Review Scope")).toBeInTheDocument()
			expect(screen.getByText("Loading scope information...")).toBeInTheDocument()
		})

		it("disables start review button when loading", () => {
			render(<ReviewScopeSelector {...defaultProps} scopeInfo={null} />)

			const startButton = screen.getByText("Start Review")
			expect(startButton).toBeDisabled()
		})
	})
})
