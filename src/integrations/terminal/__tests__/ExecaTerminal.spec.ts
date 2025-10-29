// npx vitest run src/integrations/terminal/__tests__/ExecaTerminal.spec.ts

import { RooTerminalCallbacks } from "../types"
import { ExecaTerminal } from "../ExecaTerminal"

describe("ExecaTerminal", () => {
	it("should run terminal commands and collect output", async () => {
		// TODO: Run the equivalent test for Windows.
		if (process.platform === "win32") {
			return
		}

		const terminal = new ExecaTerminal(1, "/tmp")
		let result

		const callbacks: RooTerminalCallbacks = {
			onLine: vi.fn(),
			onCompleted: (output) => (result = output),
			onShellExecutionStarted: vi.fn(),
			onShellExecutionComplete: vi.fn(),
		}

		const subprocess = terminal.runCommand("ls -al", callbacks)

		// Wait for the subprocess to start
		await subprocess

		// Wait for callbacks to be called by waiting for completion
		await new Promise<void>((resolve) => {
			const originalOnCompleted = callbacks.onCompleted
			callbacks.onCompleted = (output, process) => {
				originalOnCompleted(output, process)
				resolve()
			}
		})

		expect(callbacks.onLine).toHaveBeenCalled()
		expect(callbacks.onShellExecutionStarted).toHaveBeenCalled()
		expect(callbacks.onShellExecutionComplete).toHaveBeenCalled()

		expect(result).toBeTypeOf("string")
		expect(result).toContain("total")
	})
})
