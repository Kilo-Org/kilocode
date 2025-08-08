import React from "react"
import { render, screen } from "@testing-library/react"
import { describe, test, expect, vi } from "vitest"
import { ApiRequestModal } from "../ApiRequestModal"

// Mock the dependencies
vi.mock("@src/utils/clipboard", () => ({
	useCopyToClipboard: () => ({
		copyWithFeedback: vi.fn(),
		showCopyFeedback: false,
	}),
}))

vi.mock("@src/utils/vscode", () => ({
	vscode: {
		postMessage: vi.fn(),
	},
}))

// Mock VSCode webview UI toolkit
vi.mock("@vscode/webview-ui-toolkit/react", () => ({
	VSCodeButton: ({ children, onClick, ...props }: any) => (
		<button onClick={onClick} {...props}>
			{children}
		</button>
	),
}))

describe("ApiRequestModal", () => {
	const defaultProps = {
		isOpen: true,
		onClose: vi.fn(),
		messageText: '{"request": "test"}',
		messageId: "123",
	}

	test("renders without React hooks error", () => {
		// This test verifies that the component can render without the React error #310
		// which was caused by conditional rendering before hooks
		expect(() => {
			render(<ApiRequestModal {...defaultProps} />)
		}).not.toThrow()
	})

	test("renders modal when isOpen is true", () => {
		render(<ApiRequestModal {...defaultProps} />)
		expect(screen.getByText("API 请求详情")).toBeInTheDocument()
	})

	test("does not render when isOpen is false", () => {
		render(<ApiRequestModal {...defaultProps} isOpen={false} />)
		expect(screen.queryByText("API 请求详情")).not.toBeInTheDocument()
	})

	test("renders loading state initially", () => {
		render(<ApiRequestModal {...defaultProps} />)
		expect(screen.getByText("正在加载API数据...")).toBeInTheDocument()
	})

	test("renders tabs for request and response", () => {
		render(<ApiRequestModal {...defaultProps} />)
		expect(screen.getByText("请求信息")).toBeInTheDocument()
		expect(screen.getByText("响应信息")).toBeInTheDocument()
	})
})
