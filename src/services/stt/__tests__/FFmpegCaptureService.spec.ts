// Run: npx vitest run services/stt/__tests__/FFmpegCaptureService.spec.ts

import { EventEmitter } from "events"
import { spawn } from "child_process"
import { FFmpegCaptureService } from "../FFmpegCaptureService"

// Mock child_process
const createMockProcess = () => {
	const stdout = new EventEmitter()
	const stderr = new EventEmitter()

	stdout.removeAllListeners = vi.fn(() => stdout) as any
	stderr.removeAllListeners = vi.fn(() => stderr) as any

	return {
		stdout,
		stderr,
		kill: vi.fn(),
		on: vi.fn(),
		once: vi.fn(),
		removeAllListeners: vi.fn(),
	}
}

let mockProcess = createMockProcess()
let mockStdout = mockProcess.stdout

vi.mock("child_process", () => ({
	spawn: vi.fn(() => {
		mockProcess = createMockProcess()
		mockStdout = mockProcess.stdout
		return mockProcess
	}),
	execSync: vi.fn(() => Buffer.from("ffmpeg version")),
}))

vi.mock("os", () => ({
	platform: vi.fn(() => "darwin"),
}))

describe("FFmpegCaptureService", () => {
	let capture: FFmpegCaptureService

	beforeEach(() => {
		vi.clearAllMocks()
		capture = new FFmpegCaptureService()
	})

	afterEach(async () => {
		if (capture.isActive()) {
			await capture.stop()
		}
	})

	describe("Basic functionality", () => {
		it("should start and stop audio capture", async () => {
			expect(capture.isActive()).toBe(false)

			await capture.start()
			expect(capture.isActive()).toBe(true)

			mockProcess.once.mock.calls.find((call) => call[0] === "exit")?.[1]()
			await capture.stop()
			expect(capture.isActive()).toBe(false)
		})

		it("should emit audioData events when receiving PCM16 data", async () => {
			const audioDataHandler = vi.fn()
			capture.on("audioData", audioDataHandler)

			await capture.start()

			const testBuffer = Buffer.from([1, 2, 3, 4])
			mockStdout.emit("data", testBuffer)

			expect(audioDataHandler).toHaveBeenCalledWith(testBuffer)
		})

		it("should throw error if already capturing", async () => {
			await capture.start()
			await expect(capture.start()).rejects.toThrow("Audio capture already in progress")
		})
	})

	describe("Error handling", () => {
		it("should emit error on FFmpeg process error", async () => {
			const errorHandler = vi.fn()
			capture.on("error", errorHandler)

			await capture.start()

			const testError = new Error("FFmpeg process error")
			mockProcess.on.mock.calls.find((call) => call[0] === "error")?.[1](testError)

			expect(errorHandler).toHaveBeenCalledWith(testError)
		})
	})

	describe("Platform support", () => {
		it("should use correct FFmpeg args for macOS", async () => {
			await capture.start()

			const spawnCall = vi.mocked(spawn).mock.calls[0]
			const args = spawnCall[1] as string[]

			// Verify platform-specific input
			expect(args).toContain("-f")
			expect(args).toContain("avfoundation")

			// Verify PCM16 output format
			expect(args).toContain("-acodec")
			expect(args).toContain("pcm_s16le")
			expect(args).toContain("-ar")
			expect(args).toContain("24000") // 24kHz required by Realtime API
		})
	})
})
