import { OutputChannel } from "../classes/OutputChannel.js"
import { setLogger } from "../utils/logger.js"

describe("OutputChannel", () => {
	let mockLogger: {
		debug: ReturnType<typeof vi.fn>
		info: ReturnType<typeof vi.fn>
		warn: ReturnType<typeof vi.fn>
		error: ReturnType<typeof vi.fn>
	}

	beforeEach(() => {
		mockLogger = {
			debug: vi.fn(),
			info: vi.fn(),
			warn: vi.fn(),
			error: vi.fn(),
		}
		setLogger(mockLogger)
	})

	describe("constructor", () => {
		it("should create an output channel with the given name", () => {
			const channel = new OutputChannel("TestChannel")

			expect(channel.name).toBe("TestChannel")
		})
	})

	describe("name property", () => {
		it("should return the channel name", () => {
			const channel = new OutputChannel("MyChannel")

			expect(channel.name).toBe("MyChannel")
		})
	})

	describe("append()", () => {
		it("should log the value with channel name prefix", () => {
			const channel = new OutputChannel("TestChannel")

			channel.append("test message")

			expect(mockLogger.info).toHaveBeenCalledWith(
				"[TestChannel] test message",
				"VSCode.OutputChannel",
				undefined,
			)
		})

		it("should handle empty strings", () => {
			const channel = new OutputChannel("TestChannel")

			channel.append("")

			expect(mockLogger.info).toHaveBeenCalledWith("[TestChannel] ", "VSCode.OutputChannel", undefined)
		})
	})

	describe("appendLine()", () => {
		it("should log the value with channel name prefix", () => {
			const channel = new OutputChannel("TestChannel")

			channel.appendLine("line message")

			expect(mockLogger.info).toHaveBeenCalledWith(
				"[TestChannel] line message",
				"VSCode.OutputChannel",
				undefined,
			)
		})

		it("should handle multi-line strings", () => {
			const channel = new OutputChannel("TestChannel")

			channel.appendLine("line1\nline2")

			expect(mockLogger.info).toHaveBeenCalledWith(
				"[TestChannel] line1\nline2",
				"VSCode.OutputChannel",
				undefined,
			)
		})
	})

	describe("clear()", () => {
		it("should not throw when called", () => {
			const channel = new OutputChannel("TestChannel")

			expect(() => channel.clear()).not.toThrow()
		})
	})

	describe("show()", () => {
		it("should not throw when called without arguments", () => {
			const channel = new OutputChannel("TestChannel")

			expect(() => channel.show()).not.toThrow()
		})
	})

	describe("hide()", () => {
		it("should not throw when called", () => {
			const channel = new OutputChannel("TestChannel")

			expect(() => channel.hide()).not.toThrow()
		})
	})

	describe("dispose()", () => {
		it("should not throw when called", () => {
			const channel = new OutputChannel("TestChannel")

			expect(() => channel.dispose()).not.toThrow()
		})
	})
})
