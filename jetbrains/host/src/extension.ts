// Copyright 2009-2025 Weibo, Inc.
// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

import net from "net"
import start from "../deps/vscode/vs/workbench/api/node/extensionHostProcess.js"
import { FileRPCProtocolLogger } from "../deps/vscode/vs/workbench/services/extensions/common/fileRPCProtocolLogger.js"
import { RequestInitiator } from "../deps/vscode/vs/workbench/services/extensions/common/rpcProtocol.js"

// Create global logger instance and export for use by other modules
export const fileLoggerGlobal = new FileRPCProtocolLogger("extension")

// Command line argument parsing
const args = process.argv.slice(2)
console.log("args:", args)
const LISTEN_MODE = args.includes("--listen") || process.env.VSCODE_EXTHOST_LISTEN === "true"
const PORT = parseInt(
	args.find((arg) => arg.startsWith("--vscode-socket-port="))?.substring(21) ||
		process.env.VSCODE_EXTHOST_DEBUG_PORT ||
		"51234",
	10,
)
const SOCKET_HOST =
	args.find((arg) => arg.startsWith("--vscode-socket-host="))?.substring(21) ||
	process.env.VSCODE_EXTHOST_SOCKET_HOST ||
	"127.0.0.1"
const WILL_SEND_SOCKET =
	args.find((arg) => arg.startsWith("--vscode-will-send-socket="))?.substring(26) ||
	process.env.VSCODE_EXTHOST_WILL_SEND_SOCKET ||
	"0"
const pipeName = process.env.VSCODE_EXTHOST_IPC_HOOK

console.log(`Extension host starting in ${LISTEN_MODE ? "LISTEN" : "CONNECT"} mode`)
console.log("PORT:", PORT)
console.log("SOCKET_HOST:", SOCKET_HOST)
console.log("WILL_SEND_SOCKET:", WILL_SEND_SOCKET)
console.log("pipeName:", pipeName)

if (pipeName) {
	console.log("Using pipeName, connection will be handled by VSCode IPC")
} else {
	// Reset parameter values back to environment variables
	process.env.VSCODE_EXTHOST_SOCKET_PORT = PORT.toString()
	process.env.VSCODE_EXTHOST_SOCKET_HOST = SOCKET_HOST
	process.env.VSCODE_EXTHOST_WILL_SEND_SOCKET = WILL_SEND_SOCKET
	console.log("set send socket:", process.env.VSCODE_EXTHOST_WILL_SEND_SOCKET)

	// Save original process methods
	const originalProcessOn = process.on
	const originalProcessSend = process.send || (() => false)

	// Store message event handlers
	const messageHandlers: ((message: any, socket?: net.Socket) => void)[] = []

	// Reconnection related variables
	let isReconnecting = false
	let reconnectAttempts = 0
	const MAX_RECONNECT_ATTEMPTS = 10 // Increased from 5 to 10 for slower machines
	const RECONNECT_DELAY = 2000 // Increased from 1s to 2s for slower machines
	const RECONNECT_BACKOFF_MULTIPLIER = 1.5 // Exponential backoff

	// Override process.on
	process.on = function (event: string, listener: (...args: any[]) => void): any {
		if (event === "message") {
			messageHandlers.push((message: any, socket?: net.Socket) => {
				// Check listener parameter count
				const paramCount = listener.length
				if (paramCount === 1) {
					// If only one parameter, pass only message
					listener(message)
				} else {
					// If multiple parameters, pass message and socket
					listener(message, socket)
				}
			})
		}
		return originalProcessOn.call(process, event, listener)
	}

	// Override process.send
	process.send = function (message: any): boolean {
		if (message?.type === "VSCODE_EXTHOST_IPC_READY") {
			console.log("Extension host process is ready to receive socket")
			if (LISTEN_MODE) {
				startServer()
			} else {
				connect()
			}
		}

		// Call original process.send
		return originalProcessSend.call(process, message)
	}

	// Start server mode (for debugging)
	function startServer() {
		const server = net.createServer((socket) => {
			console.log("Main process connected to extension host")
			socket.setNoDelay(true)

			// Prepare message to send to VSCode module
			const socketMessage = {
				type: "VSCODE_EXTHOST_IPC_SOCKET",
				initialDataChunk: "",
				skipWebSocketFrames: true,
				permessageDeflate: false,
				inflateBytes: "",
			}

			// Call all saved message handlers
			messageHandlers.forEach((handler) => {
				try {
					handler(socketMessage, socket)
				} catch (error) {
					console.error("Error in message handler:", error)
				}
			})

			socket.on("error", (error) => {
				console.error("Socket error:", error)
				// Don't close server, wait for reconnection
				fileLoggerGlobal.logOutgoing(0, 0, RequestInitiator.LocalSide, "Socket error:", error)
			})

			socket.on("close", () => {
				console.log("Client connection closed, waiting for new connections...")
				fileLoggerGlobal.logOutgoing(
					0,
					0,
					RequestInitiator.LocalSide,
					"Client connection closed, waiting for new connections...",
				)
			})
		})

		// Prevent server timeout closure, keep process active
		const keepAliveInterval = setInterval(() => {
			if (server.listening) {
				console.log("Server still waiting for connections...")
			}
		}, 60000) // Print a log every minute to keep the process alive

		// Ensure timer cleanup on process exit
		process.on("exit", () => {
			clearInterval(keepAliveInterval)
		})

		server.listen(PORT, "127.0.0.1", () => {
			console.log(`Extension host server listening on 127.0.0.1:${PORT}`)
			console.log("Waiting for main process to connect...")
		})

		server.on("error", (error) => {
			console.error("Server error:", error)
			fileLoggerGlobal.logOutgoing(0, 0, RequestInitiator.LocalSide, "Server error:", error)
			// No longer exit process, only log error
			// Try to restart server
			setTimeout(() => {
				if (!server.listening) {
					console.log("Attempting to restart server after error...")
					try {
						server.listen(PORT, "127.0.0.1")
					} catch (e) {
						console.error("Failed to restart server:", e)
					}
				}
			}, 5000)
		})
	}

	// Client mode (original behavior)
	function connect() {
		if (isReconnecting) {
			console.log("Already in reconnection process, skipping")
			return
		}

		try {
			// Check connection method
			// console.log("get send socket:", process.env.VSCODE_EXTHOST_WILL_SEND_SOCKET);
			// const useSocket = process.env.VSCODE_EXTHOST_WILL_SEND_SOCKET === "1";

			// if (!useSocket) {
			//     throw new Error('No connection method specified. Please set either VSCODE_EXTHOST_IPC_HOOK or VSCODE_EXTHOST_WILL_SEND_SOCKET');
			// }

			// Use regular TCP Socket
			const host = process.env.VSCODE_EXTHOST_SOCKET_HOST || "127.0.0.1"
			const port = parseInt(process.env.VSCODE_EXTHOST_SOCKET_PORT || "0", 10)

			if (!port) {
				throw new Error("Invalid socket port")
			}

			console.log(`Attempting to connect to ${host}:${port}`)

			// Establish socket connection
			const socket = net.createConnection(port, host)
			// Set the noDelay option for the socket
			socket.setNoDelay(true)

			socket.on("connect", () => {
				console.log("Connected to main server")
				isReconnecting = false
				reconnectAttempts = 0

				// Prepare the message to be sent to the VSCode module
				const socketMessage = {
					type: "VSCODE_EXTHOST_IPC_SOCKET",
					initialDataChunk: "",
					skipWebSocketFrames: true,
					permessageDeflate: false,
					inflateBytes: "",
				}

				// Call all saved message handler functions
				messageHandlers.forEach((handler) => {
					try {
						handler(socketMessage, socket)
					} catch (error) {
						console.error("Error in message handler:", error)
					}
				})
			})

			socket.on("error", (error: Error) => {
				console.error("Socket connection error:", error)
				fileLoggerGlobal.logOutgoing(0, 0, RequestInitiator.LocalSide, "Socket connection error:", error)
				handleDisconnect()
			})

			socket.on("close", () => {
				console.log("Socket connection closed")
				handleDisconnect()
			})
		} catch (error) {
			console.error("Connection error:", error)
			fileLoggerGlobal.logOutgoing(0, 0, RequestInitiator.LocalSide, "Connection error:", error)
			handleDisconnect()
		}
	}

	// Handle disconnection
	async function handleDisconnect() {
		if (isReconnecting) {
			console.log("Already in reconnection process, skipping")
			fileLoggerGlobal.logOutgoing(0, 0, RequestInitiator.LocalSide, "Already in reconnection process, skipping")
			return
		}

		if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
			console.error("Max reconnection attempts reached. Giving up.")
			fileLoggerGlobal.logOutgoing(
				0,
				0,
				RequestInitiator.LocalSide,
				"Max reconnection attempts reached. Giving up.",
			)
			return
		}

		isReconnecting = true
		reconnectAttempts++

		console.log(`Attempting to reconnect (attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`)

		// Calculate delay with exponential backoff
		const delay = RECONNECT_DELAY * Math.pow(RECONNECT_BACKOFF_MULTIPLIER, reconnectAttempts - 1)
		console.log(`Waiting ${delay.toFixed(0)}ms before reconnecting (with exponential backoff)...`)
		await new Promise((resolve) => setTimeout(resolve, delay))
		console.log("Reconnection delay finished, attempting to connect...")

		// Reset reconnection state to allow new reconnection attempts
		isReconnecting = false
		connect()
	}
}

console.log("Starting extension host process...")

// Adjust logic: only start directly in non-LISTEN mode
if (LISTEN_MODE) {
	process.env.VSCODE_EXTHOST_WILL_SEND_SOCKET = "1"
}
start()
