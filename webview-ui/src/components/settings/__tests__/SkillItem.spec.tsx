import { render, screen, fireEvent } from "@/utils/test-utils"

import type { SkillMetadata } from "@roo-code/types"

import { SkillItem } from "../SkillItem"
import { vscode } from "@/utils/vscode"

// Mock vscode
vi.mock("@/utils/vscode", () => ({
	vscode: {
		postMessage: vi.fn(),
	},
}))

// Mock the translation hook
vi.mock("@/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({
		t: (key: string) => {
			const translations: Record<string, string> = {
				"settings:skills.editSkill": "Edit skill",
				"settings:skills.deleteSkill": "Delete skill",
				"settings:skills.changeMode": "Change mode",
				"settings:skills.modeAny": "Any mode",
			}
			return translations[key] || key
		},
	}),
}))

// Mock getAllModes
vi.mock("@roo/modes", () => ({
	getAllModes: () => [
		{ slug: "code", name: "💻 Code" },
		{ slug: "architect", name: "🏗️ Architect" },
		{ slug: "ask", name: "❓ Ask" },
	],
}))

// Mock useExtensionState
vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => ({
		customModes: [],
	}),
}))

// Mock UI components - need to support Select components
vi.mock("@/components/ui", () => ({
	Button: ({ children, onClick, className, tabIndex }: any) => (
		<button onClick={onClick} className={className} tabIndex={tabIndex} data-testid="button">
			{children}
		</button>
	),
	StandardTooltip: ({ children, content }: any) => (
		<div title={content} data-testid="tooltip">
			{children}
		</div>
	),
	Select: ({ children, value, onValueChange }: any) => (
		<div data-testid="select" data-value={value}>
			{children}
			<button data-testid="select-change-button" onClick={() => onValueChange("code")}>
				Change to code
			</button>
		</div>
	),
	SelectContent: ({ children }: any) => <div data-testid="select-content">{children}</div>,
	SelectItem: ({ children, value }: any) => (
		<div data-testid="select-item" data-value={value}>
			{children}
		</div>
	),
	SelectTrigger: ({ children, className }: any) => (
		<button data-testid="select-trigger" className={className}>
			{children}
		</button>
	),
	SelectValue: () => <span data-testid="select-value">Value</span>,
}))

const mockSkill: SkillMetadata = {
	name: "test-skill",
	description: "A test skill description",
	path: "/path/to/skill/SKILL.md",
	source: "project",
}

const mockSkillWithMode: SkillMetadata = {
	name: "mode-specific-skill",
	description: "A mode-specific skill",
	path: "/path/to/skill/SKILL.md",
	source: "global",
	mode: "architect",
}

const mockBuiltInSkill: SkillMetadata = {
	name: "built-in-skill",
	description: "A built-in skill",
	path: "<built-in:test>",
	source: "built-in",
}

describe("SkillItem", () => {
	const mockOnEdit = vi.fn()
	const mockOnDelete = vi.fn()

	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("renders skill name", () => {
		render(<SkillItem skill={mockSkill} onEdit={mockOnEdit} onDelete={mockOnDelete} />)

		expect(screen.getByText("test-skill")).toBeInTheDocument()
	})

	it("renders skill description", () => {
		render(<SkillItem skill={mockSkill} onEdit={mockOnEdit} onDelete={mockOnDelete} />)

		expect(screen.getByText("A test skill description")).toBeInTheDocument()
	})

	it("renders mode dropdown for non-built-in skills", () => {
		render(<SkillItem skill={mockSkill} onEdit={mockOnEdit} onDelete={mockOnDelete} />)

		expect(screen.getByTestId("select")).toBeInTheDocument()
	})

	it("renders mode dropdown with correct current value", () => {
		render(<SkillItem skill={mockSkillWithMode} onEdit={mockOnEdit} onDelete={mockOnDelete} />)

		const select = screen.getByTestId("select")
		expect(select).toHaveAttribute("data-value", "architect")
	})

	it("renders mode dropdown with __any__ for skills without mode", () => {
		render(<SkillItem skill={mockSkill} onEdit={mockOnEdit} onDelete={mockOnDelete} />)

		const select = screen.getByTestId("select")
		expect(select).toHaveAttribute("data-value", "__any__")
	})

	it("does not render mode dropdown for built-in skills", () => {
		render(<SkillItem skill={mockBuiltInSkill} onEdit={mockOnEdit} onDelete={mockOnDelete} />)

		// Should not have a select element
		expect(screen.queryByTestId("select")).not.toBeInTheDocument()
		// Should have a static badge instead
		expect(screen.getByText("Any mode")).toBeInTheDocument()
	})

	it("calls onEdit when edit button is clicked", () => {
		render(<SkillItem skill={mockSkill} onEdit={mockOnEdit} onDelete={mockOnDelete} />)

		const buttons = screen.getAllByTestId("button")
		// First button is edit
		fireEvent.click(buttons[0])

		expect(mockOnEdit).toHaveBeenCalledTimes(1)
	})

	it("calls onDelete when delete button is clicked for non-built-in skills", () => {
		render(<SkillItem skill={mockSkill} onEdit={mockOnEdit} onDelete={mockOnDelete} />)

		const buttons = screen.getAllByTestId("button")
		// Find the delete button (second one for non-built-in)
		fireEvent.click(buttons[1])

		expect(mockOnDelete).toHaveBeenCalledTimes(1)
	})

	it("does not render delete button for built-in skills", () => {
		render(<SkillItem skill={mockBuiltInSkill} onEdit={mockOnEdit} onDelete={mockOnDelete} />)

		// Should only have 1 button (edit) for built-in skills
		const buttons = screen.getAllByTestId("button")
		expect(buttons).toHaveLength(1)
	})

	it("calls onEdit when clicking on skill name area", () => {
		render(<SkillItem skill={mockSkill} onEdit={mockOnEdit} onDelete={mockOnDelete} />)

		const nameElement = screen.getByText("test-skill")
		fireEvent.click(nameElement)

		expect(mockOnEdit).toHaveBeenCalledTimes(1)
	})

	it("sends moveSkill message when mode is changed", () => {
		render(<SkillItem skill={mockSkill} onEdit={mockOnEdit} onDelete={mockOnDelete} />)

		// Simulate mode change
		const changeButton = screen.getByTestId("select-change-button")
		fireEvent.click(changeButton)

		expect(vscode.postMessage).toHaveBeenCalledWith({
			type: "moveSkill",
			skillName: "test-skill",
			source: "project",
			skillMode: undefined,
			newSkillMode: "code",
		})
	})

	it("sends moveSkill message with correct current mode", () => {
		render(<SkillItem skill={mockSkillWithMode} onEdit={mockOnEdit} onDelete={mockOnDelete} />)

		// Simulate mode change
		const changeButton = screen.getByTestId("select-change-button")
		fireEvent.click(changeButton)

		expect(vscode.postMessage).toHaveBeenCalledWith({
			type: "moveSkill",
			skillName: "mode-specific-skill",
			source: "global",
			skillMode: "architect",
			newSkillMode: "code",
		})
	})

	it("renders without description when not provided", () => {
		const skillWithoutDescription: SkillMetadata = {
			name: "no-desc-skill",
			description: "",
			path: "/path/to/skill/SKILL.md",
			source: "project",
		}

		render(<SkillItem skill={skillWithoutDescription} onEdit={mockOnEdit} onDelete={mockOnDelete} />)

		expect(screen.getByText("no-desc-skill")).toBeInTheDocument()
		// Description div should not be rendered when empty
		expect(screen.queryByText("A test skill description")).not.toBeInTheDocument()
	})

	it("renders with proper styling classes", () => {
		const { container } = render(<SkillItem skill={mockSkill} onEdit={mockOnEdit} onDelete={mockOnDelete} />)

		const itemDiv = container.firstChild
		expect(itemDiv).toHaveClass("hover:bg-vscode-list-hoverBackground")
	})

	it("renders edit and delete buttons for non-built-in skills", () => {
		render(<SkillItem skill={mockSkill} onEdit={mockOnEdit} onDelete={mockOnDelete} />)

		const buttons = screen.getAllByTestId("button")
		expect(buttons).toHaveLength(2)
	})

	it("includes available modes in the dropdown", () => {
		render(<SkillItem skill={mockSkill} onEdit={mockOnEdit} onDelete={mockOnDelete} />)

		// Check that select items are rendered
		const selectItems = screen.getAllByTestId("select-item")
		// Should have "Any mode" + 3 modes (code, architect, ask)
		expect(selectItems).toHaveLength(4)
	})
})
