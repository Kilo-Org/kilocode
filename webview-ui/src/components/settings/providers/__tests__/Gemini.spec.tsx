import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { Gemini } from "../Gemini"

// kilocode_change start
import type { ProviderSettings } from "@roo-code/types"
import { ExtensionStateContextProvider } from "@src/context/ExtensionStateContext"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
// kilocode_change end

vi.mock("@vscode/webview-ui-toolkit/react", () => ({
	VSCodeTextField: ({ children, value, onInput, type }: any) => (
		<div>
			{children}
			<input type={type} value={value} onChange={(e) => onInput(e)} />
		</div>
	),
	// kilocode_change start
	VSCodeLink: ({ children, href, onClick, className }: any) => (
		<a href={href} onClick={onClick} className={className}>
			{children}
		</a>
	),
	// kilocode_change end
}))

vi.mock("vscrui", () => ({
	Checkbox: ({ children, checked, onChange, "data-testid": testId, _ }: any) => (
		<label data-testid={testId}>
			<input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
			{children}
		</label>
	),
}))

vi.mock("@src/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock("@src/components/common/VSCodeButtonLink", () => ({
	VSCodeButtonLink: ({ children, href }: any) => <a href={href}>{children}</a>,
}))

// kilocode_change start
vi.mock("../ModelPicker", () => ({
	__esModule: true,
	ModelPicker: () => <div data-testid="model-picker" />,
}))
// kilocode_change end

describe("Gemini", () => {
	const defaultApiConfiguration: ProviderSettings = {
		geminiApiKey: "",
		enableUrlContext: false,
		enableGrounding: false,
	}

	const mockSetApiConfigurationField = vi.fn()

	// kilocode_change start: Custom render function with required providers
	const renderGemini_kiloCode = (props: React.ComponentProps<typeof Gemini>) => {
		const queryClient = new QueryClient()
		return render(
			<QueryClientProvider client={queryClient}>
				<ExtensionStateContextProvider>
					<Gemini {...props} />
				</ExtensionStateContextProvider>
			</QueryClientProvider>,
		)
	}
	// kilocode_change end

	beforeEach(() => {
		vi.clearAllMocks()
	})

	describe("URL Context Checkbox", () => {
		it("should render URL context checkbox unchecked by default", () => {
			renderGemini_kiloCode({
				apiConfiguration: defaultApiConfiguration,
				setApiConfigurationField: mockSetApiConfigurationField,
			})

			const urlContextCheckbox = screen.getByTestId("checkbox-url-context")
			const checkbox = urlContextCheckbox.querySelector("input[type='checkbox']") as HTMLInputElement
			expect(checkbox.checked).toBe(false)
		})

		it("should render URL context checkbox checked when enableUrlContext is true", () => {
			const apiConfiguration = { ...defaultApiConfiguration, enableUrlContext: true }
			renderGemini_kiloCode({
				apiConfiguration,
				setApiConfigurationField: mockSetApiConfigurationField,
			})

			const urlContextCheckbox = screen.getByTestId("checkbox-url-context")
			const checkbox = urlContextCheckbox.querySelector("input[type='checkbox']") as HTMLInputElement
			expect(checkbox.checked).toBe(true)
		})

		it("should call setApiConfigurationField with correct parameters when URL context checkbox is toggled", async () => {
			const user = userEvent.setup()
			renderGemini_kiloCode({
				apiConfiguration: defaultApiConfiguration,
				setApiConfigurationField: mockSetApiConfigurationField,
			})

			const urlContextCheckbox = screen.getByTestId("checkbox-url-context")
			const checkbox = urlContextCheckbox.querySelector("input[type='checkbox']") as HTMLInputElement

			await user.click(checkbox)

			expect(mockSetApiConfigurationField).toHaveBeenCalledWith("enableUrlContext", true)
		})
	})

	describe("Grounding with Google Search Checkbox", () => {
		it("should render grounding search checkbox unchecked by default", () => {
			renderGemini_kiloCode({
				apiConfiguration: defaultApiConfiguration,
				setApiConfigurationField: mockSetApiConfigurationField,
			})

			const groundingCheckbox = screen.getByTestId("checkbox-grounding-search")
			const checkbox = groundingCheckbox.querySelector("input[type='checkbox']") as HTMLInputElement
			expect(checkbox.checked).toBe(false)
		})

		it("should render grounding search checkbox checked when enableGrounding is true", () => {
			const apiConfiguration = { ...defaultApiConfiguration, enableGrounding: true }
			renderGemini_kiloCode({
				apiConfiguration,
				setApiConfigurationField: mockSetApiConfigurationField,
			})

			const groundingCheckbox = screen.getByTestId("checkbox-grounding-search")
			const checkbox = groundingCheckbox.querySelector("input[type='checkbox']") as HTMLInputElement
			expect(checkbox.checked).toBe(true)
		})

		it("should call setApiConfigurationField with correct parameters when grounding search checkbox is toggled", async () => {
			const user = userEvent.setup()
			renderGemini_kiloCode({
				apiConfiguration: defaultApiConfiguration,
				setApiConfigurationField: mockSetApiConfigurationField,
			})

			const groundingCheckbox = screen.getByTestId("checkbox-grounding-search")
			const checkbox = groundingCheckbox.querySelector("input[type='checkbox']") as HTMLInputElement

			await user.click(checkbox)

			expect(mockSetApiConfigurationField).toHaveBeenCalledWith("enableGrounding", true)
		})
	})

	// kilocode_change start: Tests changed from render() to renderGemini_kiloCode()
	describe("simplifySettings prop", () => {
		it("should hide URL context and grounding checkboxes when simplifySettings is true, but keep custom base URL", () => {
			renderGemini_kiloCode({
				apiConfiguration: defaultApiConfiguration,
				setApiConfigurationField: mockSetApiConfigurationField,
				simplifySettings: true,
			})

			// Should still render custom base URL checkbox
			expect(screen.getByTestId("checkbox-custom-base-url")).toBeInTheDocument()
			// Should not render URL context and grounding checkboxes
			expect(screen.queryByTestId("checkbox-url-context")).not.toBeInTheDocument()
			expect(screen.queryByTestId("checkbox-grounding-search")).not.toBeInTheDocument()
		})

		it("should show all checkboxes when simplifySettings is false", () => {
			renderGemini_kiloCode({
				apiConfiguration: defaultApiConfiguration,
				setApiConfigurationField: mockSetApiConfigurationField,
				simplifySettings: false,
			})

			// Should render all checkboxes
			expect(screen.getByTestId("checkbox-custom-base-url")).toBeInTheDocument()
			expect(screen.getByTestId("checkbox-url-context")).toBeInTheDocument()
			expect(screen.getByTestId("checkbox-grounding-search")).toBeInTheDocument()
		})

		it("should show all checkboxes when simplifySettings is undefined (default behavior)", () => {
			renderGemini_kiloCode({
				apiConfiguration: defaultApiConfiguration,
				setApiConfigurationField: mockSetApiConfigurationField,
			})

			// Should render all checkboxes (default behavior)
			expect(screen.getByTestId("checkbox-custom-base-url")).toBeInTheDocument()
			expect(screen.getByTestId("checkbox-url-context")).toBeInTheDocument()
			expect(screen.getByTestId("checkbox-grounding-search")).toBeInTheDocument()
		})
	})
	// kilocode_change end
})
