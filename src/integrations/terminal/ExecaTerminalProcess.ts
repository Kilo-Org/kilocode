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

			// Mark terminal as busy immediately
			this.terminal.busy = true

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

			// Emit shell_execution_started immediately after subprocess creation
			try {
				this.emit("shell_execution_started", this.pid)
			} catch (error) {
				console.error(`🚀 [ExecaTerminalProcess] Error during shell_execution_started emit:`, error)
				throw error
			}

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
									console.log(
										`🚀 [ExecaTerminalProcess] Updated PID from ${this.pid} to ${actualPid}`,
									)
									this.pid = actualPid
								}
							}
							resolve()
						})
					}, 100)
				})
			}

			// Start background monitoring (non-blocking)
			const rawStream = this.subprocess.iterable({ from: "all", preserveNewlines: true })

			// Wrap the stream to ensure all chunks are strings (execa can return Uint8Array)
			const stream = (async function* () {
				for await (const chunk of rawStream) {
					yield typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk)
				}
			})()

			// Start monitoring the stream immediately and synchronously
			// Set active stream for terminal integration
			this.terminal.setActiveStream(stream, this.pid)

			// Start immediate stream processing in background (don't await to avoid blocking)
			this.startBackgroundStreamMonitoring(stream)

			// Emit continue immediately after starting monitoring
			this.emit("continue") // Signal run() completion for background execution
		} catch (error) {
			console.error(
				`🚀 [ExecaTerminalProcess] startup error: ${error instanceof Error ? error.message : String(error)}`,
			)
			this.emit("shell_execution_complete", { exitCode: 1 })
		}
	}

	public override continue() {
		console.log(
			`🚀 [ExecaTerminalProcess] continue() called for UI detachment - subprocess continues in background: ${this.command}`,
		)

		// Stop UI output listening only
		this.emitRemainingBufferIfListening()
		this.isListening = false
		this.removeAllListeners("line")

		// Signal UI detachment complete (note: this is different from the initial continue in run())
		this.emit("continue")

		// Subprocess keeps running via detached:true - no additional logic needed!
	}

	public override abort() {
		this.aborted = true
		this.removeAllListeners("line")

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

		// Perform cleanup immediately for aborted processes
		this.performCleanup()
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

	private async startBackgroundStreamMonitoring(stream: AsyncIterable<string>) {
		// Set active stream for terminal integration
		this.terminal.setActiveStream(stream, this.pid)

		try {
			let streamLineCount = 0
			let hasEmittedFirstLine = false

			for await (const line of stream) {
				streamLineCount++

				if (streamLineCount <= 3) {
					// Only log first few lines to avoid spam
					console.log(
						`🚀 [ExecaTerminalProcess] Background stream line ${streamLineCount}: ${line.slice(0, 100)}...`,
					)
				}

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

			console.log(
				`🚀 [ExecaTerminalProcess] Terminal ${this.terminal.id} stream monitoring complete, waiting for subprocess`,
			)

			// Wait for subprocess completion if not aborted
			if (!this.aborted && this.subprocess) {
				try {
					const result = await this.subprocess
					this.emit("shell_execution_complete", { exitCode: result.exitCode ?? 0 })
				} catch (error) {
					if (error instanceof ExecaError) {
						console.error(`🚀 [ExecaTerminalProcess] background subprocess error: ${error.message}`)
						this.emit("shell_execution_complete", {
							exitCode: error.exitCode ?? 1,
							signalName: error.signal,
						})
					} else {
						console.error(
							`🚀 [ExecaTerminalProcess] background monitoring error: ${error instanceof Error ? error.message : String(error)}`,
						)
						this.emit("shell_execution_complete", { exitCode: 1 })
					}
				}
			} else if (this.aborted) {
				// Handle aborted subprocess cleanup
				if (this.subprocess) {
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
					} catch (error) {
						console.log(
							`🚀 [ExecaTerminalProcess] subprocess termination error: ${error instanceof Error ? error.message : String(error)}`,
						)
					}

					if (timeoutId) {
						clearTimeout(timeoutId)
					}
				}
			}
		} catch (error) {
			console.error(`🚀 [ExecaTerminalProcess] background monitoring error:`, error)

			if (error instanceof ExecaError) {
				this.emit("shell_execution_complete", {
					exitCode: error.exitCode ?? 1,
					signalName: error.signal,
				})
			} else {
				this.emit("shell_execution_complete", { exitCode: 1 })
			}
		} finally {
			// Final cleanup when subprocess actually completes
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
		// Clear terminal references
		this.terminal.setActiveStream(undefined)
		this.stopHotTimer()
		this.removeAllListeners("line")

		// Clear subprocess reference (process may still be running detached)
		this.subprocess = undefined

		// Mark terminal as not busy - use synchronization to prevent races
		if (this.terminal.process === this) {
			this.terminal.busy = false
		}

		// Emit completion for any listeners
		this.emit("completed", this.fullOutput)
	}
}
