// Run: npx vitest run services/stt/__tests__/FFmpegDeviceEnumerator.spec.ts

import { execSync } from "child_process"
import { listMicrophoneDevices, findFFmpeg } from "../FFmpegDeviceEnumerator"

vi.mock("child_process", () => ({
	execSync: vi.fn(() => Buffer.from("ffmpeg version")),
}))

vi.mock("os", () => ({
	platform: vi.fn(() => "darwin"),
}))

describe("FFmpegDeviceEnumerator", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	describe("findFFmpeg", () => {
		it("should find FFmpeg in PATH", () => {
			vi.mocked(execSync).mockReturnValue(Buffer.from("ffmpeg version"))
			const result = findFFmpeg(true) // Force recheck to clear cache
			expect(result.available).toBe(true)
			expect(result.path).toBe("ffmpeg")
		})

		it("should return not available when FFmpeg is not found", () => {
			vi.mocked(execSync).mockImplementation(() => {
				throw new Error("Command not found")
			})
			const result = findFFmpeg(true) // Force recheck
			expect(result.available).toBe(false)
			expect(result.error).toBeDefined()
		})
	})

	describe("listMicrophoneDevices", () => {
		it("should parse and return macOS AVFoundation devices", async () => {
			// Mock macOS AVFoundation device list output
			const macOutput = `[AVFoundation input device @ 0x123] AVFoundation video devices:
[AVFoundation input device @ 0x123] [0] FaceTime HD Camera
[AVFoundation input device @ 0x123] AVFoundation audio devices:
[AVFoundation input device @ 0x123] [0] Built-in Microphone
[AVFoundation input device @ 0x123] [1] External USB Microphone
[AVFoundation input device @ 0x123] [2] Bluetooth Headset`

			vi.mocked(execSync).mockImplementation((command: string, options?: any) => {
				if (typeof command === "string" && command.includes("-list_devices")) {
					// When encoding is specified, execSync returns a string
					return options?.encoding === "utf-8" ? macOutput : Buffer.from(macOutput)
				}
				// For version check (no encoding), return Buffer
				if (options?.stdio === "ignore") {
					return Buffer.from("ffmpeg version")
				}
				// For version check with encoding, return string
				return options?.encoding === "utf-8" ? "ffmpeg version" : Buffer.from("ffmpeg version")
			})

			// Clear cache before test
			findFFmpeg(true)

			const devices = await listMicrophoneDevices()

			// Verify device IDs are stored with colon prefix (format FFmpeg expects)
			expect(devices).toHaveLength(3)
			expect(devices[0].id).toBe(":0")
			expect(devices[0].name).toBe("Built-in Microphone")
			expect(devices[0].platform).toBe("darwin")
			expect(devices[1].id).toBe(":1")
			expect(devices[1].name).toBe("External USB Microphone")
			expect(devices[1].platform).toBe("darwin")
			expect(devices[2].id).toBe(":2")
			expect(devices[2].name).toBe("Bluetooth Headset")
			expect(devices[2].platform).toBe("darwin")
		})

		it("should throw error when FFmpeg is not found", async () => {
			// Mock execSync to throw for all FFmpeg checks (both "ffmpeg -version" and fallback paths)
			vi.mocked(execSync).mockImplementation(() => {
				throw new Error("Command not found")
			})

			// Clear cache and force recheck with the new mock
			findFFmpeg(true)

			await expect(listMicrophoneDevices()).rejects.toThrow("FFmpeg not found")
		})
	})
})
