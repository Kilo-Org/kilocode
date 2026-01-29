// npx vitest core/webview/__tests__/webviewMessageHandler.funProjects.spec.ts

import * as fs from "fs/promises"
import * as path from "path"
import * as os from "os"

// Must mock dependencies before importing the handler module.
vi.mock("../../../api/providers/fetchers/modelCache")
vi.mock("vscode")

import { webviewMessageHandler } from "../webviewMessageHandler"
import type { ClineProvider } from "../ClineProvider"

// Mock imageHelpers
vi.mock("../../tools/helpers/imageHelpers", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../../tools/helpers/imageHelpers")>()
	return {
		...actual,
		validateImageForProcessing: vi.fn().mockResolvedValue({ isValid: true, sizeInMB: 0.001 }),
		ImageMemoryTracker: vi.fn().mockImplementation(() => ({
			getTotalMemoryUsed: vi.fn().mockReturnValue(0),
			addMemoryUsage: vi.fn(),
		})),
	}
})

describe("webviewMessageHandler - fun projects", () => {
	it("creates a folder for fun projects and modifies the prompt", async () => {
		const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "roo-fun-project-"))
		try {
			const mockProvider = {
				cwd: tmpRoot,
				getCurrentTask: vi.fn().mockReturnValue(undefined),
				createTask: vi.fn().mockResolvedValue(undefined),
				postMessageToWebview: vi.fn().mockResolvedValue(undefined),
				log: vi.fn(),
				getState: vi.fn().mockResolvedValue({
					maxImageFileSize: 5,
					maxTotalImageSize: 20,
				}),
			} as unknown as ClineProvider

			await webviewMessageHandler(mockProvider, {
				type: "newTask",
				text: "Create a Snake game in HTML/CSS/JavaScript with arrow key controls and score tracking",
				images: [],
				funProject: "snake",
			} as any)

			// Check that the folder was created
			const projectPath = path.join(tmpRoot, "snake-game")
			const folderExists = await fs
				.access(projectPath)
				.then(() => true)
				.catch(() => false)
			expect(folderExists).toBe(true)

			// Check that createTask was called with the modified prompt
			expect(mockProvider.createTask).toHaveBeenCalledWith(expect.stringContaining("Create a Snake game"), [])
			expect(mockProvider.createTask).toHaveBeenCalledWith(
				expect.stringContaining('IMPORTANT: Create all files for this project inside the "snake-game" folder'),
				[],
			)
		} finally {
			await fs.rm(tmpRoot, { recursive: true, force: true })
		}
	})

	it("handles todo fun project", async () => {
		const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "roo-fun-project-"))
		try {
			const mockProvider = {
				cwd: tmpRoot,
				getCurrentTask: vi.fn().mockReturnValue(undefined),
				createTask: vi.fn().mockResolvedValue(undefined),
				postMessageToWebview: vi.fn().mockResolvedValue(undefined),
				log: vi.fn(),
				getState: vi.fn().mockResolvedValue({
					maxImageFileSize: 5,
					maxTotalImageSize: 20,
				}),
			} as unknown as ClineProvider

			await webviewMessageHandler(mockProvider, {
				type: "newTask",
				text: "Build a Todo app with React and TypeScript",
				images: [],
				funProject: "todo",
			} as any)

			// Check that the folder was created
			const projectPath = path.join(tmpRoot, "todo-game")
			const folderExists = await fs
				.access(projectPath)
				.then(() => true)
				.catch(() => false)
			expect(folderExists).toBe(true)

			// Check that createTask was called with the modified prompt
			expect(mockProvider.createTask).toHaveBeenCalledWith(
				expect.stringContaining('inside the "todo-game" folder'),
				[],
			)
		} finally {
			await fs.rm(tmpRoot, { recursive: true, force: true })
		}
	})

	it("handles weather fun project", async () => {
		const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "roo-fun-project-"))
		try {
			const mockProvider = {
				cwd: tmpRoot,
				getCurrentTask: vi.fn().mockReturnValue(undefined),
				createTask: vi.fn().mockResolvedValue(undefined),
				postMessageToWebview: vi.fn().mockResolvedValue(undefined),
				log: vi.fn(),
				getState: vi.fn().mockResolvedValue({
					maxImageFileSize: 5,
					maxTotalImageSize: 20,
				}),
			} as unknown as ClineProvider

			await webviewMessageHandler(mockProvider, {
				type: "newTask",
				text: "Make a Weather Dashboard using a weather API",
				images: [],
				funProject: "weather",
			} as any)

			// Check that the folder was created
			const projectPath = path.join(tmpRoot, "weather-game")
			const folderExists = await fs
				.access(projectPath)
				.then(() => true)
				.catch(() => false)
			expect(folderExists).toBe(true)

			// Check that createTask was called with the modified prompt
			expect(mockProvider.createTask).toHaveBeenCalledWith(
				expect.stringContaining('inside the "weather-game" folder'),
				[],
			)
		} finally {
			await fs.rm(tmpRoot, { recursive: true, force: true })
		}
	})

	it("continues with original prompt if folder creation fails", async () => {
		const tmpRoot = "/nonexistent/path/that/cannot/be/created"

		const mockProvider = {
			cwd: tmpRoot,
			getCurrentTask: vi.fn().mockReturnValue(undefined),
			createTask: vi.fn().mockResolvedValue(undefined),
			postMessageToWebview: vi.fn().mockResolvedValue(undefined),
			log: vi.fn(),
			getState: vi.fn().mockResolvedValue({
				maxImageFileSize: 5,
				maxTotalImageSize: 20,
			}),
		} as unknown as ClineProvider

		await webviewMessageHandler(mockProvider, {
			type: "newTask",
			text: "Create a Snake game",
			images: [],
			funProject: "snake",
		} as any)

		// Check that createTask was still called with the original prompt
		expect(mockProvider.createTask).toHaveBeenCalledWith("Create a Snake game", [])
		// Check that the error was logged
		expect(mockProvider.log).toHaveBeenCalledWith(expect.stringContaining("Failed to create fun project folder"))
	})

	it("works normally for non-fun-project tasks", async () => {
		const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "roo-fun-project-"))
		try {
			const mockProvider = {
				cwd: tmpRoot,
				getCurrentTask: vi.fn().mockReturnValue(undefined),
				createTask: vi.fn().mockResolvedValue(undefined),
				postMessageToWebview: vi.fn().mockResolvedValue(undefined),
				log: vi.fn(),
				getState: vi.fn().mockResolvedValue({
					maxImageFileSize: 5,
					maxTotalImageSize: 20,
				}),
			} as unknown as ClineProvider

			await webviewMessageHandler(mockProvider, {
				type: "newTask",
				text: "Write a function to sort an array",
				images: [],
			} as any)

			// Check that createTask was called with the original prompt
			expect(mockProvider.createTask).toHaveBeenCalledWith("Write a function to sort an array", [])
			// No folder should be created
			const files = await fs.readdir(tmpRoot)
			expect(files.length).toBe(0)
		} finally {
			await fs.rm(tmpRoot, { recursive: true, force: true })
		}
	})
})
