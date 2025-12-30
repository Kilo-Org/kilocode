import { describe, it, expect, vi } from "vitest"
import type { Instance, RenderOptions } from "ink"

// Use vi.hoisted to ensure the mock is available at hoist time
const { renderMock } = vi.hoisted(() => ({
	renderMock: vi.fn<[React.ReactElement, RenderOptions?], Instance>(),
}))

// Mock yoga-layout WASM binary to prevent loading issues in CI
// Must mock both the main module and the WASM loader
vi.mock("yoga-layout", () => ({
	loadYoga: () =>
		Promise.resolve({
			Node: { create: vi.fn() },
			Config: { create: vi.fn() },
		}),
}))

vi.mock("yoga-layout/load", () => ({
	loadYoga: () =>
		Promise.resolve({
			Node: { create: vi.fn() },
			Config: { create: vi.fn() },
		}),
}))

vi.mock("ink", () => ({
	render: renderMock,
}))

describe("CLI Ink render options", () => {
	it("enables incrementalRendering", async () => {
		renderMock.mockReturnValue({
			rerender: vi.fn(),
			unmount: vi.fn(),
			waitUntilExit: vi.fn().mockResolvedValue(undefined),
			cleanup: vi.fn(),
			clear: vi.fn(),
		} as unknown as Instance)

		const { createStore } = await import("jotai")
		const { CLI } = await import("../cli.js")

		const cli = new CLI({})
		// Access private properties for testing
		Object.assign(cli, {
			isInitialized: true,
			store: createStore(),
		})

		await cli.start()

		expect(renderMock).toHaveBeenCalled()
		const renderOptions = renderMock.mock.calls[0]?.[1]
		expect(renderOptions?.incrementalRendering).toBe(true)
	})
})
