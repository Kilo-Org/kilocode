import { logs, setLogger, type Logger } from "../utils/logger.js"

describe("Logger", () => {
	let originalEnv: string | undefined
	let consoleSpy: {
		log: ReturnType<typeof vi.spyOn>
		warn: ReturnType<typeof vi.spyOn>
		error: ReturnType<typeof vi.spyOn>
		debug: ReturnType<typeof vi.spyOn>
	}

	beforeEach(() => {
		originalEnv = process.env.DEBUG
		consoleSpy = {
			log: vi.spyOn(console, "log").mockImplementation(() => {}),
			warn: vi.spyOn(console, "warn").mockImplementation(() => {}),
			error: vi.spyOn(console, "error").mockImplementation(() => {}),
			debug: vi.spyOn(console, "debug").mockImplementation(() => {}),
		}
	})

	afterEach(() => {
		process.env.DEBUG = originalEnv
		vi.restoreAllMocks()
	})

	describe("logs object (default ConsoleLogger)", () => {
		describe("info()", () => {
			it("should log info message", () => {
				logs.info("Info message")

				expect(consoleSpy.log).toHaveBeenCalled()
				expect(consoleSpy.log.mock.calls[0]?.[0]).toContain("Info message")
			})

			it("should include context in log", () => {
				logs.info("Info message", "MyContext")

				expect(consoleSpy.log).toHaveBeenCalled()
				expect(consoleSpy.log.mock.calls[0]?.[0]).toContain("MyContext")
			})

			it("should use INFO as default context", () => {
				logs.info("Info message")

				expect(consoleSpy.log.mock.calls[0]?.[0]).toContain("INFO")
			})
		})

		describe("warn()", () => {
			it("should log warning message", () => {
				logs.warn("Warning message")

				expect(consoleSpy.warn).toHaveBeenCalled()
				expect(consoleSpy.warn.mock.calls[0]?.[0]).toContain("Warning message")
			})

			it("should include context in warning", () => {
				logs.warn("Warning message", "MyContext")

				expect(consoleSpy.warn.mock.calls[0]?.[0]).toContain("MyContext")
			})

			it("should use WARN as default context", () => {
				logs.warn("Warning message")

				expect(consoleSpy.warn.mock.calls[0]?.[0]).toContain("WARN")
			})
		})

		describe("error()", () => {
			it("should log error message", () => {
				logs.error("Error message")

				expect(consoleSpy.error).toHaveBeenCalled()
				expect(consoleSpy.error.mock.calls[0]?.[0]).toContain("Error message")
			})

			it("should include context in error", () => {
				logs.error("Error message", "MyContext")

				expect(consoleSpy.error.mock.calls[0]?.[0]).toContain("MyContext")
			})

			it("should use ERROR as default context", () => {
				logs.error("Error message")

				expect(consoleSpy.error.mock.calls[0]?.[0]).toContain("ERROR")
			})
		})

		describe("debug()", () => {
			it("should not log debug message when DEBUG env is not set", () => {
				delete process.env.DEBUG

				logs.debug("Debug message")

				expect(consoleSpy.debug).not.toHaveBeenCalled()
			})

			it("should log debug message when DEBUG env is set", () => {
				process.env.DEBUG = "true"

				logs.debug("Debug message")

				expect(consoleSpy.debug).toHaveBeenCalled()
				expect(consoleSpy.debug.mock.calls[0]?.[0]).toContain("Debug message")
			})

			it("should include context in debug when DEBUG is set", () => {
				process.env.DEBUG = "true"

				logs.debug("Debug message", "MyContext")

				expect(consoleSpy.debug.mock.calls[0]?.[0]).toContain("MyContext")
			})
		})
	})

	describe("setLogger()", () => {
		it("should replace default logger with custom logger", () => {
			const customLogger: Logger = {
				info: vi.fn(),
				warn: vi.fn(),
				error: vi.fn(),
				debug: vi.fn(),
			}

			setLogger(customLogger)

			logs.info("Test message", "TestContext")

			expect(customLogger.info).toHaveBeenCalledWith("Test message", "TestContext", undefined)
		})

		it("should use custom logger for all log levels", () => {
			const customLogger: Logger = {
				info: vi.fn(),
				warn: vi.fn(),
				error: vi.fn(),
				debug: vi.fn(),
			}

			setLogger(customLogger)

			logs.info("Info")
			logs.warn("Warn")
			logs.error("Error")
			logs.debug("Debug")

			expect(customLogger.info).toHaveBeenCalledTimes(1)
			expect(customLogger.warn).toHaveBeenCalledTimes(1)
			expect(customLogger.error).toHaveBeenCalledTimes(1)
			expect(customLogger.debug).toHaveBeenCalledTimes(1)
		})

		it("should pass meta parameter to custom logger", () => {
			const customLogger: Logger = {
				info: vi.fn(),
				warn: vi.fn(),
				error: vi.fn(),
				debug: vi.fn(),
			}

			setLogger(customLogger)

			const meta = { requestId: "123", userId: "456" }
			logs.info("Info with meta", "Context", meta)

			expect(customLogger.info).toHaveBeenCalledWith("Info with meta", "Context", meta)
		})
	})

	describe("Logger interface", () => {
		it("should accept custom logger implementing Logger interface", () => {
			// Create a custom logger that collects messages
			const messages: string[] = []
			const customLogger: Logger = {
				info: (message) => messages.push(`INFO: ${message}`),
				warn: (message) => messages.push(`WARN: ${message}`),
				error: (message) => messages.push(`ERROR: ${message}`),
				debug: (message) => messages.push(`DEBUG: ${message}`),
			}

			setLogger(customLogger)

			logs.info("Test info")
			logs.warn("Test warn")
			logs.error("Test error")
			logs.debug("Test debug")

			expect(messages).toContain("INFO: Test info")
			expect(messages).toContain("WARN: Test warn")
			expect(messages).toContain("ERROR: Test error")
			expect(messages).toContain("DEBUG: Test debug")
		})
	})
})
