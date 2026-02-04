import * as fs from "fs/promises"
import * as path from "path"
import * as os from "os"

// Must mock dependencies before importing the handler module.
vi.mock("../../../api/providers/fetchers/modelCache")

import { webviewMessageHandler } from "../webviewMessageHandler"
import type { ClineProvider } from "../ClineProvider"

vi.mock("vscode", () => ({
	window: {
		showInformationMessage: vi.fn(),
		showErrorMessage: vi.fn(),
	},
	workspace: {
		workspaceFolders: [{ uri: { fsPath: "/mock/workspace" } }],
	},
}))

// Mock imageHelpers - use actual implementations for functions that need real file access
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

describe("webviewMessageHandler - image mentions (integration)", () => {
	it("resolves image mentions for newTask and passes images to createTask", async () => {
		const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "roo-image-mentions-"))
		try {
			const imgBytes = Buffer.from("png-bytes")
			await fs.writeFile(path.join(tmpRoot, "cat.png"), imgBytes)

			const mockProvider = {
				cwd: tmpRoot,
				getCurrentTask: vi.fn().mockReturnValue(undefined),
				createTask: vi.fn().mockResolvedValue(undefined),
				postMessageToWebview: vi.fn().mockResolvedValue(undefined),
				getState: vi.fn().mockResolvedValue({
					maxImageFileSize: 5,
					maxTotalImageSize: 20,
				}),
			} as unknown as ClineProvider

			await webviewMessageHandler(mockProvider, {
				type: "newTask",
				text: "Please look at @/cat.png",
				images: [],
			} as any)

			expect(mockProvider.createTask).toHaveBeenCalledWith("Please look at @/cat.png", [
				`data:image/png;base64,${imgBytes.toString("base64")}`,
			])
		} finally {
			await fs.rm(tmpRoot, { recursive: true, force: true })
		}
	})

	it("resolves image mentions for askResponse and passes images to handleWebviewAskResponse", async () => {
		const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "roo-image-mentions-"))
		try {
			const imgBytes = Buffer.from("jpg-bytes")
			await fs.writeFile(path.join(tmpRoot, "cat.jpg"), imgBytes)

			const handleWebviewAskResponse = vi.fn()
			const mockProvider = {
				cwd: tmpRoot,
				getCurrentTask: vi.fn().mockReturnValue({
					cwd: tmpRoot,
					handleWebviewAskResponse,
				}),
				getState: vi.fn().mockResolvedValue({
					maxImageFileSize: 5,
					maxTotalImageSize: 20,
				}),
			} as unknown as ClineProvider

			await webviewMessageHandler(mockProvider, {
				type: "askResponse",
				askResponse: "messageResponse",
				text: "Please look at @/cat.jpg",
				images: [],
			} as any)

			expect(handleWebviewAskResponse).toHaveBeenCalledWith("messageResponse", "Please look at @/cat.jpg", [
				`data:image/jpeg;base64,${imgBytes.toString("base64")}`,
			])
		} finally {
			await fs.rm(tmpRoot, { recursive: true, force: true })
		}
	})

	it("resolves gif image mentions (matching read_file behavior)", async () => {
		const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "roo-image-mentions-"))
		try {
			const imgBytes = Buffer.from("gif-bytes")
			await fs.writeFile(path.join(tmpRoot, "animation.gif"), imgBytes)

			const mockProvider = {
				cwd: tmpRoot,
				getCurrentTask: vi.fn().mockReturnValue(undefined),
				createTask: vi.fn().mockResolvedValue(undefined),
				postMessageToWebview: vi.fn().mockResolvedValue(undefined),
				getState: vi.fn().mockResolvedValue({
					maxImageFileSize: 5,
					maxTotalImageSize: 20,
				}),
			} as unknown as ClineProvider

			await webviewMessageHandler(mockProvider, {
				type: "newTask",
				text: "See @/animation.gif",
				images: [],
			} as any)

			expect(mockProvider.createTask).toHaveBeenCalledWith("See @/animation.gif", [
				`data:image/gif;base64,${imgBytes.toString("base64")}`,
			])
		} finally {
			await fs.rm(tmpRoot, { recursive: true, force: true })
		}
	})
})
