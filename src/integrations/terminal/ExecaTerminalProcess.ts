import { execa, ExecaError } from "execa"
import psTree from "ps-tree"
import process from "process"

import type { RooTerminal } from "./types"
import { BaseTerminalProcess } from "./BaseTerminalProcess"

export class ExecaTerminalProcess extends BaseTerminalProcess {
	private terminalRef: WeakRef<RooTerminal>
	private aborted = false
	private pid?: number
	private subprocess?: ReturnType<typeof execa>
	private pidUpdatePromise?: Promise<void>

	constructor(terminal: RooTerminal) {
		super()

		this.terminalRef = new WeakRef(terminal)

		this.once("completed", () => {
			this.terminal.busy = false
		})
	}

	public get terminal(): RooTerminal {
		const terminal = this.terminalRef.deref()

		if (!terminal) {
			throw new Error("Unable to dereference terminal")
		}

		return terminal
	}

	public override async run(command: string) {
		this.command = command

		try {
			this.isHot = true
			this.terminal.busy = true // kilocode_change

			this.subprocess = execa({
				shell: true,
				cwd: this.terminal.getCurrentWorkingDirectory(),
				all: true,
				stdin: "ignore", // kilocode_change: ignore stdin to prevent blocking
				detached: true, // kilocode_change: Process runs independently in background
				cleanup: true, // kilocode_change: Automatically clean up on process exit
				env: {
					...process.env,
					// Ensure UTF-8 encoding for Ruby, CocoaPods, etc.
					LANG: "en_US.UTF-8",
					LC_ALL: "en_US.UTF-8",
				},
			})`${command}`

			this.pid = this.subprocess.pid
			this.emit("shell_execution_started", this.pid) // kilocode_change

			// When using shell: true, the PID is for the shell, not the actual command
			// Find the actual command PID after a small delay
			if (this.pid) {
				this.pidUpdatePromise = new Promise<void>((resolve) => {
					setTimeout(() => {
						psTree(this.pid!, (err, children) => {
							if (!err && children.length > 0) {
								// Update PID to the first child (the actual command)
								const actualPid = parseInt(children[0].PID)
								if (!isNaN(actualPid)) {
									this.pid = actualPid
								}
							}
							resolve()
						})
					}, 100)
				})
			}

			const rawStream = this.subprocess.iterable({ from: "all", preserveNewlines: true })

			// Wrap the stream to ensure all chunks are strings (execa can return Uint8Array)
			const stream = (async function* () {
				for await (const chunk of rawStream) {
					yield typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk)
				}
			})()

			this.terminal.setActiveStream(stream, this.pid)

			// kilocode_change - Start immediate stream processing in background (don't await to avoid blocking)
			this.startBackgroundStreamMonitoring(stream)
			this.emit("continue") // Signal run() completion for background execution
		} catch (error) {
			this.emit("shell_execution_complete", { exitCode: 1 })
		}
	}

	public override continue() {
		this.emitRemainingBufferIfListening() // kilocode_change
		this.isListening = false
		this.removeAllListeners("line")
		this.emit("continue")
	}

	public override abort() {
		this.aborted = true
		this.removeAllListeners("line") // kilocode_change

		// Function to perform the kill operations
		const performKill = () => {
			// Try to kill using the subprocess object
			if (this.subprocess) {
				try {
					this.subprocess.kill("SIGKILL")
				} catch (e) {
					console.warn(
						`[ExecaTerminalProcess#abort] Failed to kill subprocess: ${e instanceof Error ? e.message : String(e)}`,
					)
				}
			}

			// Kill the stored PID (which should be the actual command after our update)
			if (this.pid) {
				try {
					process.kill(this.pid, "SIGKILL")
				} catch (e) {
					console.warn(
						`[ExecaTerminalProcess#abort] Failed to kill process ${this.pid}: ${e instanceof Error ? e.message : String(e)}`,
					)
				}
			}
		}

		// If PID update is in progress, wait for it before killing
		if (this.pidUpdatePromise) {
			this.pidUpdatePromise.then(performKill).catch(() => performKill())
		} else {
			performKill()
		}

		// Continue with the rest of the abort logic
		if (this.pid) {
			// Also check for any child processes
			psTree(this.pid, async (err, children) => {
				if (!err) {
					const pids = children.map((p) => parseInt(p.PID))
					console.error(`[ExecaTerminalProcess#abort] SIGKILL children -> ${pids.join(", ")}`)

					for (const pid of pids) {
						try {
							process.kill(pid, "SIGKILL")
						} catch (e) {
							console.warn(
								`[ExecaTerminalProcess#abort] Failed to send SIGKILL to child PID ${pid}: ${e instanceof Error ? e.message : String(e)}`,
							)
						}
					}
				} else {
					console.error(
						`[ExecaTerminalProcess#abort] Failed to get process tree for PID ${this.pid}: ${err.message}`,
					)
				}
			})
		}
		this.performCleanup() // kilocode_change
	}

	public override hasUnretrievedOutput() {
		return this.lastRetrievedIndex < this.fullOutput.length
	}

	public override getUnretrievedOutput() {
		let output = this.fullOutput.slice(this.lastRetrievedIndex)
		let index = output.lastIndexOf("\n")

		if (index === -1) {
			return ""
		}

		index++
		this.lastRetrievedIndex += index

		// console.log(
		// 	`[ExecaTerminalProcess#getUnretrievedOutput] fullOutput.length=${this.fullOutput.length} lastRetrievedIndex=${this.lastRetrievedIndex}`,
		// 	output.slice(0, index),
		// )

		return output.slice(0, index)
	}

	private emitRemainingBufferIfListening() {
		if (!this.isListening) {
			return
		}

		const output = this.getUnretrievedOutput()

		if (output !== "") {
			this.emit("line", output)
		}
	}

	// kilocode_change start - startBackgroundStreamMonitoring
	private async startBackgroundStreamMonitoring(stream: AsyncIterable<string>) {
		this.terminal.setActiveStream(stream, this.pid)

		try {
			let streamLineCount = 0
			let hasEmittedFirstLine = false
			let streamError: Error | undefined

			for await (const line of stream) {
				streamLineCount++
				if (this.aborted) {
					break
				}

				// Continue collecting output
				this.fullOutput += line

				// Emit line events for listeners (like tests)
				if (!hasEmittedFirstLine) {
					hasEmittedFirstLine = true
				}

				// Always emit line events for listeners during testing/monitoring
				this.emit("line", line)

				// Emit output if UI is listening (for real-time display)
				if (this.isListening) {
					const now = Date.now()
					if (now - this.lastEmitTime_ms > 500 || this.lastEmitTime_ms === 0) {
						this.emitRemainingBufferIfListening()
						this.lastEmitTime_ms = now
					}
				}

				this.startHotTimer(line)
			}

			if (!this.aborted && this.subprocess) {
				try {
					const result = await this.subprocess
					this.emit("shell_execution_complete", { exitCode: result.exitCode ?? 0 })
				} catch (error) {
					if (error instanceof ExecaError) {
						this.emit("shell_execution_complete", {
							exitCode: error.exitCode ?? 1,
							signalName: error.signal,
						})
					} else {
						this.emit("shell_execution_complete", { exitCode: 1 })
					}
				}
			} else if (this.aborted && this.subprocess) {
				let timeoutId: NodeJS.Timeout | undefined

				const kill = new Promise<void>((resolve) => {
					timeoutId = setTimeout(() => {
						try {
							this.subprocess?.kill("SIGKILL")
						} catch (e) {}

						resolve()
					}, 5_000)
				})

				try {
					await Promise.race([this.subprocess, kill])
				} catch (_error) {}

				if (timeoutId) {
					clearTimeout(timeoutId)
				}
			}

			// If we had a stream error but subprocess completed, log it
			if (streamError) {
				console.warn("[ExecaTerminalProcess] Stream error occurred but subprocess completed:", streamError)
			}
		} catch (error) {
			// Unexpected error in monitoring logic
			console.error("[ExecaTerminalProcess] Unexpected error in background monitoring:", error)
			if (error instanceof ExecaError) {
				this.emit("shell_execution_complete", {
					exitCode: error.exitCode ?? 1,
					signalName: error.signal,
				})
			} else {
				this.emit("shell_execution_complete", { exitCode: 1 })
			}
		} finally {
			this.performFinalCleanup()
		}
	}
	private performCleanup() {
		this.terminal.setActiveStream(undefined)
		this.stopHotTimer()
		this.removeAllListeners("line")
		this.subprocess = undefined
	}
	private performFinalCleanup() {
		this.terminal.setActiveStream(undefined)
		this.stopHotTimer()
		this.removeAllListeners()

		// Clear subprocess reference (process may still be running detached)
		this.subprocess = undefined

		// Mark terminal as not busy - atomic check to prevent race conditions
		// Only clear busy flag if this process is still the active process
		if (this.terminal.process === this && this.terminal.busy) {
			this.terminal.busy = false
		}
		this.emit("completed", this.fullOutput)
	}
	// kilocode_change end - startBackgroundStreamMonitoring
}
