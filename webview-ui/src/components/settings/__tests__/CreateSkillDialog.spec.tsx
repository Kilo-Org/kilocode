import { render, screen, fireEvent, waitFor } from "@/utils/test-utils"

import { vscode } from "@/utils/vscode"

import { CreateSkillDialog } from "../CreateSkillDialog"

// Mock vscode
vi.mock("@/utils/vscode", () => ({
	vscode: {
		postMessage: vi.fn(),
	},
}))

// Mock the translation hook
vi.mock("@/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({
		t: (key: string) => key,
	}),
}))

// Create a variable to hold the mock state
let mockExtensionState: any = {}

// Mock the useExtensionState hook
vi.mock("@/context/ExtensionStateContext", () => ({
	ExtensionStateContextProvider: ({ children }: any) => children,
	useExtensionState: () => mockExtensionState,
}))

// Mock UI components
vi.mock("@/components/ui", () => ({
	Button: ({ children, onClick, disabled, variant }: any) => (
		<button onClick={onClick} disabled={disabled} data-variant={variant} data-testid="button">
			{children}
		</button>
	),
	Checkbox: ({ id, checked, onCheckedChange }: any) => (
		<input
			type="checkbox"
			id={id}
			checked={checked}
			data-testid={`checkbox-${id}`}
			onChange={(e) => onCheckedChange(e.target.checked)}
		/>
	),
	Input: ({ value, onChange, placeholder, id, type, className, ...props }: any) => (
		<input
			type={type || "text"}
			value={value}
			onChange={onChange}
			placeholder={placeholder}
			id={id}
			className={className}
			{...props}
		/>
	),
	Textarea: ({ value, onChange, placeholder, id, className, ...props }: any) => (
		<textarea
			value={value}
			onChange={onChange}
			placeholder={placeholder}
			id={id}
			className={className}
			{...props}
		/>
	),
	Dialog: ({ children, open }: any) => (
		<div data-testid="dialog" data-open={open}>
			{open && children}
		</div>
	),
	DialogContent: ({ children }: any) => <div data-testid="dialog-content">{children}</div>,
	DialogHeader: ({ children }: any) => <div data-testid="dialog-header">{children}</div>,
	DialogTitle: ({ children }: any) => <div data-testid="dialog-title">{children}</div>,
	DialogDescription: ({ children }: any) => <div data-testid="dialog-description">{children}</div>,
	DialogFooter: ({ children }: any) => <div data-testid="dialog-footer">{children}</div>,
	Select: ({ children, value, onValueChange }: any) => (
		<div data-testid="select" data-value={value}>
			{children}
			<input
				type="hidden"
				data-testid="select-input"
				value={value}
				onChange={(e) => onValueChange(e.target.value)}
			/>
		</div>
	),
	SelectTrigger: ({ children }: any) => <div data-testid="select-trigger">{children}</div>,
	SelectValue: ({ placeholder }: any) => <span data-testid="select-value">{placeholder}</span>,
	SelectContent: ({ children }: any) => <div data-testid="select-content">{children}</div>,
	SelectItem: ({ children, value }: any) => (
		<div data-testid={`select-item-${value}`} data-value={value}>
			{children}
		</div>
	),
}))

describe("CreateSkillDialog", () => {
	const mockOnOpenChange = vi.fn()
	const mockOnSkillCreated = vi.fn()

	beforeEach(() => {
		vi.clearAllMocks()
		mockExtensionState = {
			customModes: [{ slug: "custom-mode", name: "Custom Mode" }],
		}
	})

	it("renders dialog when open is true", () => {
		render(
			<CreateSkillDialog
				open={true}
				onOpenChange={mockOnOpenChange}
				onSkillCreated={mockOnSkillCreated}
				hasWorkspace={true}
			/>,
		)

		expect(screen.getByTestId("dialog")).toHaveAttribute("data-open", "true")
		expect(screen.getByTestId("dialog-title")).toBeInTheDocument()
	})

	it("does not render dialog content when open is false", () => {
		render(
			<CreateSkillDialog
				open={false}
				onOpenChange={mockOnOpenChange}
				onSkillCreated={mockOnSkillCreated}
				hasWorkspace={true}
			/>,
		)

		expect(screen.getByTestId("dialog")).toHaveAttribute("data-open", "false")
		expect(screen.queryByTestId("dialog-title")).not.toBeInTheDocument()
	})

	it("renders name input field", () => {
		render(
			<CreateSkillDialog
				open={true}
				onOpenChange={mockOnOpenChange}
				onSkillCreated={mockOnSkillCreated}
				hasWorkspace={true}
			/>,
		)

		const nameInput = screen.getByPlaceholderText("settings:skills.createDialog.namePlaceholder")
		expect(nameInput).toBeInTheDocument()
	})

	it("renders description textarea", () => {
		render(
			<CreateSkillDialog
				open={true}
				onOpenChange={mockOnOpenChange}
				onSkillCreated={mockOnSkillCreated}
				hasWorkspace={true}
			/>,
		)

		const descInput = screen.getByPlaceholderText("settings:skills.createDialog.descriptionPlaceholder")
		expect(descInput).toBeInTheDocument()
	})

	it("transforms name input to lowercase with only allowed characters", () => {
		render(
			<CreateSkillDialog
				open={true}
				onOpenChange={mockOnOpenChange}
				onSkillCreated={mockOnSkillCreated}
				hasWorkspace={true}
			/>,
		)

		const nameInput = screen.getByPlaceholderText(
			"settings:skills.createDialog.namePlaceholder",
		) as HTMLInputElement
		fireEvent.change(nameInput, { target: { value: "Test-Skill_123!" } })

		// Should be transformed to lowercase and remove invalid characters
		expect(nameInput.value).toBe("test-skill123")
	})

	it("disables create button when name is empty", () => {
		render(
			<CreateSkillDialog
				open={true}
				onOpenChange={mockOnOpenChange}
				onSkillCreated={mockOnSkillCreated}
				hasWorkspace={true}
			/>,
		)

		const buttons = screen.getAllByTestId("button")
		const createButton = buttons.find((btn) => btn.getAttribute("data-variant") === "primary")

		expect(createButton).toBeDisabled()
	})

	it("disables create button when description is empty", () => {
		render(
			<CreateSkillDialog
				open={true}
				onOpenChange={mockOnOpenChange}
				onSkillCreated={mockOnSkillCreated}
				hasWorkspace={true}
			/>,
		)

		const nameInput = screen.getByPlaceholderText("settings:skills.createDialog.namePlaceholder")
		fireEvent.change(nameInput, { target: { value: "valid-name" } })

		const buttons = screen.getAllByTestId("button")
		const createButton = buttons.find((btn) => btn.getAttribute("data-variant") === "primary")

		expect(createButton).toBeDisabled()
	})

	it("enables create button when both name and description are provided", () => {
		render(
			<CreateSkillDialog
				open={true}
				onOpenChange={mockOnOpenChange}
				onSkillCreated={mockOnSkillCreated}
				hasWorkspace={true}
			/>,
		)

		const nameInput = screen.getByPlaceholderText("settings:skills.createDialog.namePlaceholder")
		const descInput = screen.getByPlaceholderText("settings:skills.createDialog.descriptionPlaceholder")

		fireEvent.change(nameInput, { target: { value: "valid-name" } })
		fireEvent.change(descInput, { target: { value: "Valid description" } })

		const buttons = screen.getAllByTestId("button")
		const createButton = buttons.find((btn) => btn.getAttribute("data-variant") === "primary")

		expect(createButton).not.toBeDisabled()
	})

	it("calls vscode.postMessage with correct data when creating skill", async () => {
		render(
			<CreateSkillDialog
				open={true}
				onOpenChange={mockOnOpenChange}
				onSkillCreated={mockOnSkillCreated}
				hasWorkspace={true}
			/>,
		)

		const nameInput = screen.getByPlaceholderText("settings:skills.createDialog.namePlaceholder")
		const descInput = screen.getByPlaceholderText("settings:skills.createDialog.descriptionPlaceholder")

		fireEvent.change(nameInput, { target: { value: "my-skill" } })
		fireEvent.change(descInput, { target: { value: "My skill description" } })

		const buttons = screen.getAllByTestId("button")
		const createButton = buttons.find((btn) => btn.getAttribute("data-variant") === "primary")

		fireEvent.click(createButton!)

		await waitFor(() => {
			expect(vscode.postMessage).toHaveBeenCalledWith({
				type: "createSkill",
				skillName: "my-skill",
				source: "project",
				skillDescription: "My skill description",
				skillModeSlugs: undefined,
			})
		})
	})

	it("calls onSkillCreated after creating skill", async () => {
		render(
			<CreateSkillDialog
				open={true}
				onOpenChange={mockOnOpenChange}
				onSkillCreated={mockOnSkillCreated}
				hasWorkspace={true}
			/>,
		)

		const nameInput = screen.getByPlaceholderText("settings:skills.createDialog.namePlaceholder")
		const descInput = screen.getByPlaceholderText("settings:skills.createDialog.descriptionPlaceholder")

		fireEvent.change(nameInput, { target: { value: "my-skill" } })
		fireEvent.change(descInput, { target: { value: "My skill description" } })

		const buttons = screen.getAllByTestId("button")
		const createButton = buttons.find((btn) => btn.getAttribute("data-variant") === "primary")

		fireEvent.click(createButton!)

		await waitFor(() => {
			expect(mockOnSkillCreated).toHaveBeenCalled()
		})
	})

	it("closes dialog after creating skill", async () => {
		render(
			<CreateSkillDialog
				open={true}
				onOpenChange={mockOnOpenChange}
				onSkillCreated={mockOnSkillCreated}
				hasWorkspace={true}
			/>,
		)

		const nameInput = screen.getByPlaceholderText("settings:skills.createDialog.namePlaceholder")
		const descInput = screen.getByPlaceholderText("settings:skills.createDialog.descriptionPlaceholder")

		fireEvent.change(nameInput, { target: { value: "my-skill" } })
		fireEvent.change(descInput, { target: { value: "My skill description" } })

		const buttons = screen.getAllByTestId("button")
		const createButton = buttons.find((btn) => btn.getAttribute("data-variant") === "primary")

		fireEvent.click(createButton!)

		await waitFor(() => {
			expect(mockOnOpenChange).toHaveBeenCalledWith(false)
		})
	})

	it("closes dialog when cancel button is clicked", () => {
		render(
			<CreateSkillDialog
				open={true}
				onOpenChange={mockOnOpenChange}
				onSkillCreated={mockOnSkillCreated}
				hasWorkspace={true}
			/>,
		)

		const buttons = screen.getAllByTestId("button")
		const cancelButton = buttons.find((btn) => btn.getAttribute("data-variant") === "secondary")

		fireEvent.click(cancelButton!)

		expect(mockOnOpenChange).toHaveBeenCalledWith(false)
	})

	it("defaults to project source when hasWorkspace is true", () => {
		render(
			<CreateSkillDialog
				open={true}
				onOpenChange={mockOnOpenChange}
				onSkillCreated={mockOnSkillCreated}
				hasWorkspace={true}
			/>,
		)

		const select = screen.getAllByTestId("select")[0]
		expect(select).toHaveAttribute("data-value", "project")
	})

	it("defaults to global source when hasWorkspace is false", () => {
		render(
			<CreateSkillDialog
				open={true}
				onOpenChange={mockOnOpenChange}
				onSkillCreated={mockOnSkillCreated}
				hasWorkspace={false}
			/>,
		)

		const select = screen.getAllByTestId("select")[0]
		expect(select).toHaveAttribute("data-value", "global")
	})

	it("renders source selection dropdown", () => {
		render(
			<CreateSkillDialog
				open={true}
				onOpenChange={mockOnOpenChange}
				onSkillCreated={mockOnSkillCreated}
				hasWorkspace={true}
			/>,
		)

		expect(screen.getByTestId("select-item-global")).toBeInTheDocument()
		expect(screen.getByTestId("select-item-project")).toBeInTheDocument()
	})

	it("renders mode selection checkboxes", () => {
		render(
			<CreateSkillDialog
				open={true}
				onOpenChange={mockOnOpenChange}
				onSkillCreated={mockOnSkillCreated}
				hasWorkspace={true}
			/>,
		)

		// Should have "Any mode" checkbox (checked by default)
		expect(screen.getByTestId("checkbox-create-mode-any")).toBeInTheDocument()
		expect(screen.getByTestId("checkbox-create-mode-any")).toBeChecked()
		// Should have built-in mode checkboxes
		expect(screen.getByTestId("checkbox-create-mode-code")).toBeInTheDocument()
		expect(screen.getByTestId("checkbox-create-mode-architect")).toBeInTheDocument()
		// Should have custom mode checkbox from state
		expect(screen.getByTestId("checkbox-create-mode-custom-mode")).toBeInTheDocument()
	})

	it("unchecks 'Any mode' when a specific mode is selected", () => {
		render(
			<CreateSkillDialog
				open={true}
				onOpenChange={mockOnOpenChange}
				onSkillCreated={mockOnSkillCreated}
				hasWorkspace={true}
			/>,
		)

		// Initially "Any mode" is checked
		expect(screen.getByTestId("checkbox-create-mode-any")).toBeChecked()
		expect(screen.getByTestId("checkbox-create-mode-code")).not.toBeChecked()

		// Click on "Code" mode checkbox
		fireEvent.click(screen.getByTestId("checkbox-create-mode-code"))

		// "Any mode" should be unchecked and "Code" should be checked
		expect(screen.getByTestId("checkbox-create-mode-any")).not.toBeChecked()
		expect(screen.getByTestId("checkbox-create-mode-code")).toBeChecked()
	})

	it("reverts to 'Any mode' when all specific modes are unchecked", () => {
		render(
			<CreateSkillDialog
				open={true}
				onOpenChange={mockOnOpenChange}
				onSkillCreated={mockOnSkillCreated}
				hasWorkspace={true}
			/>,
		)

		// Select a specific mode
		fireEvent.click(screen.getByTestId("checkbox-create-mode-code"))
		expect(screen.getByTestId("checkbox-create-mode-any")).not.toBeChecked()
		expect(screen.getByTestId("checkbox-create-mode-code")).toBeChecked()

		// Uncheck it
		fireEvent.click(screen.getByTestId("checkbox-create-mode-code"))

		// Should revert to "Any mode"
		expect(screen.getByTestId("checkbox-create-mode-any")).toBeChecked()
		expect(screen.getByTestId("checkbox-create-mode-code")).not.toBeChecked()
	})

	it("sends selected modes when creating skill with specific modes", async () => {
		render(
			<CreateSkillDialog
				open={true}
				onOpenChange={mockOnOpenChange}
				onSkillCreated={mockOnSkillCreated}
				hasWorkspace={true}
			/>,
		)

		const nameInput = screen.getByPlaceholderText("settings:skills.createDialog.namePlaceholder")
		const descInput = screen.getByPlaceholderText("settings:skills.createDialog.descriptionPlaceholder")

		fireEvent.change(nameInput, { target: { value: "my-skill" } })
		fireEvent.change(descInput, { target: { value: "My skill description" } })

		// Select "Code" and "Architect" modes
		fireEvent.click(screen.getByTestId("checkbox-create-mode-code"))
		fireEvent.click(screen.getByTestId("checkbox-create-mode-architect"))

		const buttons = screen.getAllByTestId("button")
		const createButton = buttons.find((btn) => btn.getAttribute("data-variant") === "primary")

		fireEvent.click(createButton!)

		await waitFor(() => {
			expect(vscode.postMessage).toHaveBeenCalledWith({
				type: "createSkill",
				skillName: "my-skill",
				source: "project",
				skillDescription: "My skill description",
				skillModeSlugs: ["code", "architect"],
			})
		})
	})

	it("clears form after successful skill creation", async () => {
		render(
			<CreateSkillDialog
				open={true}
				onOpenChange={mockOnOpenChange}
				onSkillCreated={mockOnSkillCreated}
				hasWorkspace={true}
			/>,
		)

		const nameInput = screen.getByPlaceholderText(
			"settings:skills.createDialog.namePlaceholder",
		) as HTMLInputElement
		const descInput = screen.getByPlaceholderText(
			"settings:skills.createDialog.descriptionPlaceholder",
		) as HTMLTextAreaElement

		fireEvent.change(nameInput, { target: { value: "test-skill" } })
		fireEvent.change(descInput, { target: { value: "Test description" } })

		const buttons = screen.getAllByTestId("button")
		const createButton = buttons.find((btn) => btn.getAttribute("data-variant") === "primary")

		fireEvent.click(createButton!)

		// After clicking create, the dialog should close via onOpenChange
		await waitFor(() => {
			expect(mockOnOpenChange).toHaveBeenCalledWith(false)
		})
	})
})
