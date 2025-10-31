// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

import net from "net"

// Save original process methods
const originalProcessOn = process.on
const originalProcessSend = process.send || (() => false)

// Store message event handlers
const messageHandlers: ((message: any, socket?: net.Socket) => void)[] = []

// Reconnection related variables
let isReconnecting = false
let reconnectAttempts = 0
const MAX_RECONNECT_ATTEMPTS = 5
const RECONNECT_DELAY = 1000 // 1 second

// Override process.on
process.on = function (event: string, listener: (...args: any[]) => void): any {
	if (event === "message") {
		messageHandlers.push((message: any, socket?: net.Socket) => {
			// Check the number of parameters for listener
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
		connect()
	}

	// Call original process.send
	return originalProcessSend.call(process, message)
}

// Establish socket connection
function connect() {
	if (isReconnecting) {
		console.log("Already in reconnection process, skipping")
		return
	}

	try {
		// Get socket server information from environment variables
		const host = process.env.VSCODE_EXTHOST_SOCKET_HOST || "127.0.0.1"
		const port = parseInt(process.env.VSCODE_EXTHOST_SOCKET_PORT || "0", 10)

		if (!port) {
			throw new Error("Invalid socket port")
		}

		console.log(`Attempting to connect to ${host}:${port}`)

		// Establish socket connection
		const socket = net.createConnection(port, host)
		// Set socket noDelay option
		socket.setNoDelay(true)

		socket.on("connect", () => {
			console.log("Connected to main server")
			isReconnecting = false
			reconnectAttempts = 0

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
		})

		socket.on("error", (error: Error) => {
			console.error("Socket connection error:", error)
			handleDisconnect()
		})

		socket.on("close", () => {
			console.log("Socket connection closed")
			handleDisconnect()
		})
	} catch (error) {
		console.error("Connection error:", error)
		handleDisconnect()
	}
}

// Handle disconnection
async function handleDisconnect() {
	if (isReconnecting) {
		console.log("Already in reconnection process, skipping")
		return
	}

	isReconnecting = true
	reconnectAttempts++

	if (reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
		console.error("Max reconnection attempts reached. Giving up.")
		isReconnecting = false
		return
	}

	console.log(`Attempting to reconnect (attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`)

	// Wait for a while before retrying
	console.log(`Waiting ${RECONNECT_DELAY}ms before reconnecting...`)
	await new Promise((resolve) => setTimeout(resolve, RECONNECT_DELAY))
	console.log("Reconnection delay finished, attempting to connect...")
	connect()
}

console.log("Starting extension host process...")

import start from "./deps/vscode/vs/workbench/api/node/extensionHostProcess.js"

// This line will trigger extension host related logic startup, actual logic is in extensionHostProcess,
// Do not handle specific plugin business logic in subsequent content of this file
start()
