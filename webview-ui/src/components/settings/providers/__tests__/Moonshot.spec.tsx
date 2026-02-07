// kilocode_change - new file
import { render, screen } from "@testing-library/react"

import type { ProviderSettings } from "@roo-code/types"

import { Moonshot } from "../Moonshot"

vi.mock("@vscode/webview-ui-toolkit/react", () => ({
	VSCodeTextField: ({ children, value, onInput, type, placeholder, className }: any) => (
		<div>
			{children}
			<input
				type={type}
				value={value}
				onChange={(event) => onInput?.(event)}
				placeholder={placeholder}
				className={className}
			/>
		</div>
	),
	VSCodeDropdown: ({ children, value, onChange, className }: any) => (
		<select value={value} onChange={(event) => onChange?.(event)} className={className}>
			{children}
		</select>
	),
	VSCodeOption: ({ children, value, className }: any) => (
		<option value={value} className={className}>
			{children}
		</option>
	),
}))

vi.mock("@src/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock("@src/components/common/VSCodeButtonLink", () => ({
	VSCodeButtonLink: ({ href, children }: any) => <a href={href}>{children}</a>,
}))

describe("Moonshot", () => {
	const setApiConfigurationField = vi.fn()

	const renderMoonshot = (apiConfiguration: ProviderSettings) =>
		render(<Moonshot apiConfiguration={apiConfiguration} setApiConfigurationField={setApiConfigurationField} />)

	afterEach(() => {
		vi.clearAllMocks()
	})

	it("uses kimi code URL for coding endpoint", () => {
		renderMoonshot({
			apiProvider: "moonshot",
			moonshotBaseUrl: "https://api.kimi.com/coding/v1",
			moonshotApiKey: "",
		})

		expect(screen.getByRole("link", { name: "settings:providers.getMoonshotApiKey" })).toHaveAttribute(
			"href",
			"https://www.kimi.com/code",
		)
	})

	it("uses Moonshot CN URL for CN endpoint", () => {
		renderMoonshot({
			apiProvider: "moonshot",
			moonshotBaseUrl: "https://api.moonshot.cn/v1",
			moonshotApiKey: "",
		})

		expect(screen.getByRole("link", { name: "settings:providers.getMoonshotApiKey" })).toHaveAttribute(
			"href",
			"https://platform.moonshot.cn/console/api-keys",
		)
	})

	it("uses Moonshot global URL for global endpoint", () => {
		renderMoonshot({
			apiProvider: "moonshot",
			moonshotBaseUrl: "https://api.moonshot.ai/v1",
			moonshotApiKey: "",
		})

		expect(screen.getByRole("link", { name: "settings:providers.getMoonshotApiKey" })).toHaveAttribute(
			"href",
			"https://platform.moonshot.ai/console/api-keys",
		)
	})
})
