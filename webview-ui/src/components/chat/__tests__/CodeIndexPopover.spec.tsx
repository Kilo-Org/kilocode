import { render, screen, fireEvent } from "@/utils/test-utils"
import React from "react"
import type { IndexingStatus } from "@roo/ExtensionMessage"
import { CodeIndexPopover } from "../CodeIndexPopover"
import { vscode } from "@src/utils/vscode"

// Mock external dependencies
vi.mock("@src/utils/vscode", () => ({
	vscode: {
		postMessage: vi.fn(),
	},
}))

const t = (key: string) => {
	const translations: Record<string, string> = {
		"settings:codeIndex.title": "Codebase Indexing",
		"settings:codeIndex.cancelIndexingButton": "Cancel Indexing",
		"settings:codeIndex.cancelling": "Cancelling...",
		"settings:codeIndex.indexingStatuses.indexing": "Indexing",
		"settings:codeIndex.indexingStatuses.standby": "Standby",
		"settings:codeIndex.description": "settings:codeIndex.description",
		"settings:codeIndex.enableLabel": "Enable",
		"settings:codeIndex.statusTitle": "Status",
		"settings:codeIndex.setupConfigLabel": "Setup",
		"settings:codeIndex.advancedConfigLabel": "Advanced",
	}
	return translations[key] || key
}

const mockUseAppTranslation = { t }
vi.mock("@src/i18n/TranslationContext", () => ({
	useAppTranslation: () => mockUseAppTranslation,
}))

vi.mock("react-i18next", () => ({
	Trans: ({ i18nKey, children }: { i18nKey?: string; children?: React.ReactNode }) => (
		<>{i18nKey ? <span>{i18nKey}</span> : children}</>
	),
}))

const mockExtensionState = {
	codebaseIndexConfig: {
		codebaseIndexEnabled: true,
		codebaseIndexQdrantUrl: "http://localhost:6333",
		codebaseIndexEmbedderProvider: "openai",
		codebaseIndexEmbedderModelId: "text-embedding-3-small",
		codebaseIndexSearchMaxResults: 5,
		codebaseIndexSearchMinScore: 0.5,
	},
	codebaseIndexModels: {
		openai: {
			"text-embedding-3-small": { dimension: 1536 },
			"text-embedding-ada-002": { dimension: 1536 },
		},
	},
	cwd: "/test/workspace",
}
vi.mock("@src/context/ExtensionStateContext", () => ({
	useExtensionState: () => mockExtensionState,
}))

// Mock UI components
vi.mock("@vscode/webview-ui-toolkit/react", () => ({
	VSCodeButton: ({
		children,
		onClick,
		...props
	}: {
		children: React.ReactNode
		onClick?: () => void
		[key: string]: any
	}) => (
		<button onClick={onClick} {...props}>
			{children}
		</button>
	),
	VSCodeTextField: ({
		onInput,
		value,
		...props
	}: {
		onInput?: (e: any) => void
		value?: string
		[key: string]: any
	}) => <input value={value || ""} onChange={onInput} {...props} />,
	VSCodeDropdown: ({ children, ...props }: { children: React.ReactNode; [key: string]: any }) => (
		<select {...props}>{children}</select>
	),
	VSCodeOption: ({ children, value, ...props }: { children: React.ReactNode; value: string; [key: string]: any }) => (
		<option value={value} {...props}>
			{children}
		</option>
	),
	VSCodeLink: ({ children, href, ...props }: { children: React.ReactNode; href?: string; [key: string]: any }) => (
		<a href={href} {...props}>
			{children}
		</a>
	),
	VSCodeCheckbox: ({
		children,
		checked,
		onChange,
		...props
	}: {
		children: React.ReactNode
		checked?: boolean
		onChange?: (e: any) => void
		[key: string]: any
	}) => (
		<label {...props}>
			<input type="checkbox" checked={checked || false} onChange={onChange} />
			{children}
		</label>
	),
}))

vi.mock("@src/components/ui", () => ({
	Button: ({
		children,
		onClick,
		disabled,
		...props
	}: {
		children: React.ReactNode
		onClick?: () => void
		disabled?: boolean
		[key: string]: any
	}) => (
		<button onClick={onClick} disabled={disabled} {...props}>
			{children}
		</button>
	),
	Popover: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	PopoverTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	PopoverContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	Select: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	SelectItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	SelectTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	SelectValue: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	AlertDialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	AlertDialogTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	AlertDialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	AlertDialogAction: ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) => (
		<button onClick={onClick}>{children}</button>
	),
	AlertDialogCancel: ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) => (
		<button onClick={onClick}>{children}</button>
	),
	AlertDialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
	AlertDialogFooter: ({ children }: { children: React.ReactNode }) => <footer>{children}</footer>,
	AlertDialogHeader: ({ children }: { children: React.ReactNode }) => <header>{children}</header>,
	AlertDialogTitle: ({ children }: { children: React.ReactNode }) => <h4>{children}</h4>,
	Slider: () => <div>Slider</div>,
	StandardTooltip: ({ children, content }: { children: React.ReactNode; content: string }) => (
		<div title={content}>{children}</div>
	),
}))

vi.mock("@radix-ui/react-progress", () => ({
	Root: ({ children, ...props }: { children: React.ReactNode; [key: string]: any }) => (
		<div {...props}>{children}</div>
	),
	Indicator: (props: any) => <div {...props} />,
}))

vi.mock("lucide-react", () => ({
	AlertTriangle: (props: any) => <span {...props}>Alert</span>,
}))

vi.mock("@src/components/ui/hooks/useRooPortal", () => ({
	useRooPortal: () => document.body,
}))

vi.mock("@src/hooks/useEscapeKey", () => ({
	useEscapeKey: vi.fn(),
}))

vi.mock("@src/utils/docLinks", () => ({
	buildDocLink: (path: string) => `https://docs.example.com/${path}`,
}))

describe("CodeIndexPopover", () => {
	const initialIndexingStatus: IndexingStatus = {
		systemStatus: "Standby",
		message: "",
		processedItems: 0,
		totalItems: 0,
		currentItemUnit: "items",
	}

	it("should render the popover window content", () => {
		render(
			<CodeIndexPopover indexingStatus={initialIndexingStatus}>
				<button>Open Popover</button>
			</CodeIndexPopover>,
		)

		// With the simplified mock, the content is always rendered.
		expect(screen.getByText("Codebase Indexing")).toBeInTheDocument()
		expect(screen.getByText("settings:codeIndex.description")).toBeInTheDocument()
		expect(screen.getByText("Enable")).toBeInTheDocument()
		expect(screen.getByText("Status")).toBeInTheDocument()
		expect(screen.getByText("Setup")).toBeInTheDocument()
		expect(screen.getByText("Advanced")).toBeInTheDocument()
	})

	it("should send cancelIndexing message when cancel button is clicked", async () => {
		const indexingStatus: IndexingStatus = {
			systemStatus: "Indexing",
			message: "Processing...",
			processedItems: 50,
			totalItems: 100,
			currentItemUnit: "items",
		}

		render(
			<CodeIndexPopover indexingStatus={indexingStatus}>
				<button>Open Popover</button>
			</CodeIndexPopover>,
		)

		const cancelButton = screen.getByText("Cancel Indexing")
		fireEvent.click(cancelButton)

		expect(vscode.postMessage).toHaveBeenCalledWith({ type: "cancelIndexing" })

		// Check for optimistic UI update for the message
		const statusMessage = await screen.findByText(/Cancelling.../i)
		expect(statusMessage).toBeInTheDocument()
	})
})
