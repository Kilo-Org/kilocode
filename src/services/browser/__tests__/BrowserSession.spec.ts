// npx vitest services/browser/__tests__/BrowserSession.spec.ts

import * as path from "path"
import { BrowserSession } from "../BrowserSession"
import { discoverChromeHostUrl, tryChromeHostUrl } from "../browserDiscovery"

// Mock dependencies
vi.mock("vscode", () => ({
	ExtensionContext: vi.fn(),
	Uri: {
		file: vi.fn((path) => ({ fsPath: path })),
	},
}))

// Mock puppeteer-core
vi.mock("puppeteer-core", () => {
	const mockBrowser = {
		newPage: vi.fn().mockResolvedValue({
			goto: vi.fn().mockResolvedValue(undefined),
			on: vi.fn(),
			off: vi.fn(),
			screenshot: vi.fn().mockResolvedValue("mockScreenshotBase64"),
			url: vi.fn().mockReturnValue("https://example.com"),
		}),
		pages: vi.fn().mockResolvedValue([]),
		close: vi.fn().mockResolvedValue(undefined),
		disconnect: vi.fn().mockResolvedValue(undefined),
	}

	return {
		Browser: vi.fn(),
		Page: vi.fn(),
		TimeoutError: class TimeoutError extends Error {},
		launch: vi.fn().mockResolvedValue(mockBrowser),
		connect: vi.fn().mockResolvedValue(mockBrowser),
	}
})

// Mock PCR
vi.mock("puppeteer-chromium-resolver", () => {
	return {
		default: vi.fn().mockResolvedValue({
			puppeteer: {
				launch: vi.fn().mockImplementation(async () => {
					const { launch } = await import("puppeteer-core")
					return launch()
				}),
			},
			executablePath: "/mock/path/to/chromium",
		}),
	}
})

// Mock fs
vi.mock("fs/promises", () => ({
	mkdir: vi.fn().mockResolvedValue(undefined),
	readFile: vi.fn(),
	writeFile: vi.fn(),
	access: vi.fn(),
}))

// Mock fileExistsAtPath
vi.mock("../../../utils/fs", () => ({
	fileExistsAtPath: vi.fn().mockResolvedValue(false),
}))

// Mock browser discovery functions
vi.mock("../browserDiscovery", () => ({
	discoverChromeHostUrl: vi.fn().mockResolvedValue(null),
	tryChromeHostUrl: vi.fn().mockResolvedValue(false),
}))

// Mock delay
vi.mock("delay", () => ({
	default: vi.fn().mockResolvedValue(undefined),
}))

// Mock p-wait-for
vi.mock("p-wait-for", () => ({
	default: vi.fn().mockResolvedValue(undefined),
}))

describe("BrowserSession", () => {
	let browserSession: BrowserSession
	let mockContext: any

	beforeEach(() => {
		vi.clearAllMocks()

		// Set up mock context
		mockContext = {
			globalState: {
				get: vi.fn(),
				update: vi.fn(),
			},
			globalStorageUri: {
				fsPath: "/mock/global/storage/path",
			},
			extensionUri: {
				fsPath: "/mock/extension/path",
			},
		}

		// Create browser session
		browserSession = new BrowserSession(mockContext)
	})

	describe("Remote browser disabled", () => {
		it("should launch a local browser when remote browser is disabled", async () => {
			// Mock context to indicate remote browser is disabled
			mockContext.globalState.get.mockImplementation((key: string) => {
				if (key === "remoteBrowserEnabled") return false
				return undefined
			})

			await browserSession.launchBrowser()

			const puppeteerCore = await import("puppeteer-core")

			// Verify that a local browser was launched
			expect(puppeteerCore.launch).toHaveBeenCalled()

			// Verify that remote browser connection was not attempted
			expect(discoverChromeHostUrl).not.toHaveBeenCalled()
			expect(tryChromeHostUrl).not.toHaveBeenCalled()

			expect((browserSession as any).isUsingRemoteBrowser).toBe(false)
		})
	})

	describe("Remote browser successfully connects", () => {
		it("should connect to a remote browser when enabled and connection succeeds", async () => {
			// Mock context to indicate remote browser is enabled
			mockContext.globalState.get.mockImplementation((key: string) => {
				if (key === "remoteBrowserEnabled") return true
				if (key === "remoteBrowserHost") return "http://remote-browser:9222"
				return undefined
			})

			// Mock successful remote browser connection
			vi.mocked(tryChromeHostUrl).mockResolvedValue(true)

			await browserSession.launchBrowser()

			const puppeteerCore = await import("puppeteer-core")

			// Verify that connect was called
			expect(puppeteerCore.connect).toHaveBeenCalled()

			// Verify that local browser was not launched
			expect(puppeteerCore.launch).not.toHaveBeenCalled()

			expect((browserSession as any).isUsingRemoteBrowser).toBe(true)
		})
	})

	describe("Remote browser enabled but falls back to local", () => {
		it("should fall back to local browser when remote connection fails", async () => {
			// Mock context to indicate remote browser is enabled
			mockContext.globalState.get.mockImplementation((key: string) => {
				if (key === "remoteBrowserEnabled") return true
				if (key === "remoteBrowserHost") return "http://remote-browser:9222"
				return undefined
			})

			// Mock failed remote browser connection
			vi.mocked(tryChromeHostUrl).mockResolvedValue(false)
			vi.mocked(discoverChromeHostUrl).mockResolvedValue(null)

			await browserSession.launchBrowser()

			// Import puppeteer-core to check if launch was called
			const puppeteerCore = await import("puppeteer-core")

			// Verify that local browser was launched as fallback
			expect(puppeteerCore.launch).toHaveBeenCalled()

			// Verify that isUsingRemoteBrowser is false
			expect((browserSession as any).isUsingRemoteBrowser).toBe(false)
		})
	})

	describe("closeBrowser", () => {
		it("should close a local browser properly", async () => {
			const puppeteerCore = await import("puppeteer-core")

			// Create a mock browser directly
			const mockBrowser = {
				newPage: vi.fn().mockResolvedValue({}),
				pages: vi.fn().mockResolvedValue([]),
				close: vi.fn().mockResolvedValue(undefined),
				disconnect: vi.fn().mockResolvedValue(undefined),
			}

			// Set browser and page on the session
			;(browserSession as any).browser = mockBrowser
			;(browserSession as any).page = {}
			;(browserSession as any).isUsingRemoteBrowser = false

			await browserSession.closeBrowser()

			// Verify that browser.close was called
			expect(mockBrowser.close).toHaveBeenCalled()
			expect(mockBrowser.disconnect).not.toHaveBeenCalled()

			// Verify that browser state was reset
			expect((browserSession as any).browser).toBeUndefined()
			expect((browserSession as any).page).toBeUndefined()
			expect((browserSession as any).isUsingRemoteBrowser).toBe(false)
		})

		it("should disconnect from a remote browser properly", async () => {
			// Create a mock browser directly
			const mockBrowser = {
				newPage: vi.fn().mockResolvedValue({}),
				pages: vi.fn().mockResolvedValue([]),
				close: vi.fn().mockResolvedValue(undefined),
				disconnect: vi.fn().mockResolvedValue(undefined),
			}

			// Set browser and page on the session
			;(browserSession as any).browser = mockBrowser
			;(browserSession as any).page = {}
			;(browserSession as any).isUsingRemoteBrowser = true

			await browserSession.closeBrowser()

			// Verify that browser.disconnect was called
			expect(mockBrowser.disconnect).toHaveBeenCalled()
			expect(mockBrowser.close).not.toHaveBeenCalled()
		})
	})

	it("forces same-tab behavior before click", async () => {
		// Prepare a minimal mock page with required APIs
		const page: any = {
			on: vi.fn(),
			off: vi.fn(),
			screenshot: vi.fn().mockResolvedValue("mockScreenshotBase64"),
			url: vi.fn().mockReturnValue("https://example.com"),
			viewport: vi.fn().mockReturnValue({ width: 900, height: 600 }),
			waitForNavigation: vi.fn().mockResolvedValue(undefined),
			evaluate: vi.fn().mockResolvedValue(undefined),
			mouse: {
				click: vi.fn().mockResolvedValue(undefined),
				move: vi.fn().mockResolvedValue(undefined),
			},
		}

		;(browserSession as any).page = page

		// Spy on the forceLinksToSameTab helper to ensure it's invoked
		const forceSpy = vi.fn().mockResolvedValue(undefined)
		;(browserSession as any).forceLinksToSameTab = forceSpy

		await browserSession.click("10,20")

		expect(forceSpy).toHaveBeenCalledTimes(1)
		expect(forceSpy).toHaveBeenCalledWith(page)
		expect(page.mouse.click).toHaveBeenCalledWith(10, 20)
	})
})

describe("keyboard press", () => {
	it("presses a keyboard key", async () => {
		// Prepare a minimal mock page with required APIs
		const page: any = {
			on: vi.fn(),
			off: vi.fn(),
			screenshot: vi.fn().mockResolvedValue("mockScreenshotBase64"),
			url: vi.fn().mockReturnValue("https://example.com"),
			viewport: vi.fn().mockReturnValue({ width: 900, height: 600 }),
			waitForNavigation: vi.fn().mockResolvedValue(undefined),
			evaluate: vi.fn().mockResolvedValue(undefined),
			keyboard: {
				press: vi.fn().mockResolvedValue(undefined),
				type: vi.fn().mockResolvedValue(undefined),
			},
		}

		// Create a fresh BrowserSession with a mock context
		const mockCtx: any = {
			globalState: { get: vi.fn(), update: vi.fn() },
			globalStorageUri: { fsPath: "/mock/global/storage/path" },
			extensionUri: { fsPath: "/mock/extension/path" },
		}
		const session = new BrowserSession(mockCtx)

		;(session as any).page = page

		await session.press("Enter")

		expect(page.keyboard.press).toHaveBeenCalledTimes(1)
		expect(page.keyboard.press).toHaveBeenCalledWith("Enter")
	})
})

describe("cursor visualization", () => {
	it("should draw cursor indicator when cursor position exists", async () => {
		// Prepare a minimal mock page with required APIs
		const page: any = {
			on: vi.fn(),
			off: vi.fn(),
			screenshot: vi.fn().mockResolvedValue("mockScreenshotBase64"),
			url: vi.fn().mockReturnValue("https://example.com"),
			viewport: vi.fn().mockReturnValue({ width: 900, height: 600 }),
			evaluate: vi.fn().mockResolvedValue(undefined),
			mouse: {
				click: vi.fn().mockResolvedValue(undefined),
			},
		}

		// Create a fresh BrowserSession with a mock context
		const mockCtx: any = {
			globalState: { get: vi.fn(), update: vi.fn() },
			globalStorageUri: { fsPath: "/mock/global/storage/path" },
			extensionUri: { fsPath: "/mock/extension/path" },
		}
		const session = new BrowserSession(mockCtx)

		;(session as any).page = page

		// Perform a click action which sets cursor position
		const result = await session.click("100,200")

		// Verify cursor indicator was drawn and removed
		// evaluate is called 3 times: 1 for forceLinksToSameTab, 1 for draw cursor, 1 for remove cursor
		expect(page.evaluate).toHaveBeenCalled()

		// Verify the result includes cursor position
		expect(result.currentMousePosition).toBe("100,200")
	})

	it("should include cursor position in action result", async () => {
		// Prepare a minimal mock page with required APIs
		const page: any = {
			on: vi.fn(),
			off: vi.fn(),
			screenshot: vi.fn().mockResolvedValue("mockScreenshotBase64"),
			url: vi.fn().mockReturnValue("https://example.com"),
			viewport: vi.fn().mockReturnValue({ width: 900, height: 600 }),
			evaluate: vi.fn().mockResolvedValue(undefined),
			mouse: {
				move: vi.fn().mockResolvedValue(undefined),
			},
		}

		// Create a fresh BrowserSession with a mock context
		const mockCtx: any = {
			globalState: { get: vi.fn(), update: vi.fn() },
			globalStorageUri: { fsPath: "/mock/global/storage/path" },
			extensionUri: { fsPath: "/mock/extension/path" },
		}
		const session = new BrowserSession(mockCtx)

		;(session as any).page = page

		// Perform a hover action which sets cursor position
		const result = await session.hover("150,250")

		// Verify the result includes cursor position
		expect(result.currentMousePosition).toBe("150,250")
		expect(result.viewportWidth).toBe(900)
		expect(result.viewportHeight).toBe(600)
	})

	it("should not draw cursor indicator when no cursor position exists", async () => {
		// Prepare a minimal mock page with required APIs
		const page: any = {
			on: vi.fn(),
			off: vi.fn(),
			screenshot: vi.fn().mockResolvedValue("mockScreenshotBase64"),
			url: vi.fn().mockReturnValue("https://example.com"),
			viewport: vi.fn().mockReturnValue({ width: 900, height: 600 }),
			evaluate: vi.fn().mockResolvedValue(undefined),
		}

		// Create a fresh BrowserSession with a mock context
		const mockCtx: any = {
			globalState: { get: vi.fn(), update: vi.fn() },
			globalStorageUri: { fsPath: "/mock/global/storage/path" },
			extensionUri: { fsPath: "/mock/extension/path" },
		}
		const session = new BrowserSession(mockCtx)

		;(session as any).page = page

		// Perform scroll action which doesn't set cursor position
		const result = await session.scrollDown()

		// Verify evaluate was called only for scroll operation (not for cursor drawing/removal)
		// scrollDown calls evaluate once for scrolling
		expect(page.evaluate).toHaveBeenCalledTimes(1)

		// Verify no cursor position in result
		expect(result.currentMousePosition).toBeUndefined()
	})

	describe("saveScreenshot", () => {
		// Use a cross-platform workspace path for testing
		const testWorkspace = path.resolve("/workspace")

		it("should save screenshot to specified path with png format", async () => {
			const mockFs = await import("fs/promises")
			const page: any = {
				on: vi.fn(),
				off: vi.fn(),
				screenshot: vi.fn().mockResolvedValue("mockScreenshotBase64"),
				url: vi.fn().mockReturnValue("https://example.com"),
				viewport: vi.fn().mockReturnValue({ width: 900, height: 600 }),
				evaluate: vi.fn().mockResolvedValue(undefined),
			}

			const mockCtx: any = {
				globalState: { get: vi.fn(), update: vi.fn() },
				globalStorageUri: { fsPath: "/mock/global/storage/path" },
				extensionUri: { fsPath: "/mock/extension/path" },
			}
			const session = new BrowserSession(mockCtx)
			;(session as any).page = page

			await session.saveScreenshot("screenshots/test.png", testWorkspace)

			expect(mockFs.mkdir).toHaveBeenCalledWith(path.join(testWorkspace, "screenshots"), { recursive: true })
			expect(page.screenshot).toHaveBeenCalledWith(
				expect.objectContaining({
					path: path.join(testWorkspace, "screenshots", "test.png"),
					type: "png",
				}),
			)
		})

		it("should save screenshot with jpeg format for .jpg extension", async () => {
			const page: any = {
				on: vi.fn(),
				off: vi.fn(),
				screenshot: vi.fn().mockResolvedValue("mockScreenshotBase64"),
				url: vi.fn().mockReturnValue("https://example.com"),
				viewport: vi.fn().mockReturnValue({ width: 900, height: 600 }),
				evaluate: vi.fn().mockResolvedValue(undefined),
			}

			const mockCtx: any = {
				globalState: { get: vi.fn().mockReturnValue(80), update: vi.fn() },
				globalStorageUri: { fsPath: "/mock/global/storage/path" },
				extensionUri: { fsPath: "/mock/extension/path" },
			}
			const session = new BrowserSession(mockCtx)
			;(session as any).page = page

			await session.saveScreenshot("screenshots/test.jpg", testWorkspace)

			expect(page.screenshot).toHaveBeenCalledWith(
				expect.objectContaining({
					path: path.join(testWorkspace, "screenshots", "test.jpg"),
					type: "jpeg",
					quality: 80,
				}),
			)
		})

		it("should save screenshot with webp format", async () => {
			const page: any = {
				on: vi.fn(),
				off: vi.fn(),
				screenshot: vi.fn().mockResolvedValue("mockScreenshotBase64"),
				url: vi.fn().mockReturnValue("https://example.com"),
				viewport: vi.fn().mockReturnValue({ width: 900, height: 600 }),
				evaluate: vi.fn().mockResolvedValue(undefined),
			}

			const mockCtx: any = {
				globalState: { get: vi.fn().mockReturnValue(75), update: vi.fn() },
				globalStorageUri: { fsPath: "/mock/global/storage/path" },
				extensionUri: { fsPath: "/mock/extension/path" },
			}
			const session = new BrowserSession(mockCtx)
			;(session as any).page = page

			await session.saveScreenshot("test.webp", testWorkspace)

			expect(page.screenshot).toHaveBeenCalledWith(
				expect.objectContaining({
					path: path.join(testWorkspace, "test.webp"),
					type: "webp",
					quality: 75,
				}),
			)
		})

		it("should reject absolute file paths outside workspace", async () => {
			// Create a cross-platform absolute path for testing
			const absolutePath = path.resolve("/absolute/path/screenshot.png")
			const page: any = {
				on: vi.fn(),
				off: vi.fn(),
				screenshot: vi.fn().mockResolvedValue("mockScreenshotBase64"),
				url: vi.fn().mockReturnValue("https://example.com"),
				viewport: vi.fn().mockReturnValue({ width: 900, height: 600 }),
				evaluate: vi.fn().mockResolvedValue(undefined),
			}

			const mockCtx: any = {
				globalState: { get: vi.fn(), update: vi.fn() },
				globalStorageUri: { fsPath: "/mock/global/storage/path" },
				extensionUri: { fsPath: "/mock/extension/path" },
			}
			const session = new BrowserSession(mockCtx)
			;(session as any).page = page

			await expect(session.saveScreenshot(absolutePath, testWorkspace)).rejects.toThrow(/outside the workspace/)

			expect(page.screenshot).not.toHaveBeenCalled()
		})

		it("should reject paths with .. that escape the workspace", async () => {
			const page: any = {
				on: vi.fn(),
				off: vi.fn(),
				screenshot: vi.fn().mockResolvedValue("mockScreenshotBase64"),
				url: vi.fn().mockReturnValue("https://example.com"),
				viewport: vi.fn().mockReturnValue({ width: 900, height: 600 }),
				evaluate: vi.fn().mockResolvedValue(undefined),
			}

			const mockCtx: any = {
				globalState: { get: vi.fn(), update: vi.fn() },
				globalStorageUri: { fsPath: "/mock/global/storage/path" },
				extensionUri: { fsPath: "/mock/extension/path" },
			}
			const session = new BrowserSession(mockCtx)
			;(session as any).page = page

			await expect(session.saveScreenshot("../../etc/passwd", testWorkspace)).rejects.toThrow(
				/outside the workspace/,
			)

			expect(page.screenshot).not.toHaveBeenCalled()
		})

		it("should allow paths with .. that stay within workspace", async () => {
			const mockFs = await import("fs/promises")
			const page: any = {
				on: vi.fn(),
				off: vi.fn(),
				screenshot: vi.fn().mockResolvedValue("mockScreenshotBase64"),
				url: vi.fn().mockReturnValue("https://example.com"),
				viewport: vi.fn().mockReturnValue({ width: 900, height: 600 }),
				evaluate: vi.fn().mockResolvedValue(undefined),
			}

			const mockCtx: any = {
				globalState: { get: vi.fn(), update: vi.fn() },
				globalStorageUri: { fsPath: "/mock/global/storage/path" },
				extensionUri: { fsPath: "/mock/extension/path" },
			}
			const session = new BrowserSession(mockCtx)
			;(session as any).page = page

			// Path like "subdir/../screenshot.png" should resolve to "screenshot.png" within workspace
			await session.saveScreenshot("subdir/../screenshot.png", testWorkspace)

			expect(page.screenshot).toHaveBeenCalledWith(
				expect.objectContaining({
					path: path.join(testWorkspace, "screenshot.png"),
					type: "png",
				}),
			)
		})
	})

	describe("getViewportSize", () => {
		it("falls back to configured viewport when no page or last viewport is available", () => {
			const localCtx: any = {
				globalState: {
					get: vi.fn((key: string) => {
						if (key === "browserViewportSize") return "1024x768"
						return undefined
					}),
					update: vi.fn(),
				},
				globalStorageUri: { fsPath: "/mock/global/storage/path" },
				extensionUri: { fsPath: "/mock/extension/path" },
			}

			const session = new BrowserSession(localCtx)
			const vp = (session as any).getViewportSize()
			expect(vp).toEqual({ width: 1024, height: 768 })
		})

		it("returns live page viewport when available and updates lastViewport cache", () => {
			const localCtx: any = {
				globalState: {
					get: vi.fn(),
					update: vi.fn(),
				},
				globalStorageUri: { fsPath: "/mock/global/storage/path" },
				extensionUri: { fsPath: "/mock/extension/path" },
			}
			const session = new BrowserSession(localCtx)
			;(session as any).page = {
				viewport: vi.fn().mockReturnValue({ width: 1111, height: 555 }),
			}

			const vp = (session as any).getViewportSize()
			expect(vp).toEqual({ width: 1111, height: 555 })
			expect((session as any).lastViewportWidth).toBe(1111)
			expect((session as any).lastViewportHeight).toBe(555)
		})

		it("returns cached last viewport when page no longer exists", () => {
			const localCtx: any = {
				globalState: {
					get: vi.fn(),
					update: vi.fn(),
				},
				globalStorageUri: { fsPath: "/mock/global/storage/path" },
				extensionUri: { fsPath: "/mock/extension/path" },
			}
			const session = new BrowserSession(localCtx)
			;(session as any).lastViewportWidth = 800
			;(session as any).lastViewportHeight = 600

			const vp = (session as any).getViewportSize()
			expect(vp).toEqual({ width: 800, height: 600 })
		})
	})
})
