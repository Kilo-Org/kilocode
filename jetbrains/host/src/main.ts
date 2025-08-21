// Copyright 2009-2025 Weibo, Inc.
// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

import { fork } from "child_process"
import * as path from "path"
import { fileURLToPath } from "url"
import * as net from "net"
import { VSBuffer } from "../deps/vscode/vs/base/common/buffer.js"
import { NodeSocket } from "../deps/vscode/vs/base/parts/ipc/node/ipc.net.js"
import { PersistentProtocol } from "../deps/vscode/vs/base/parts/ipc/common/ipc.net.js"
import { DEBUG_PORT } from "./config.js"
import {
	MessageType,
	createMessageOfType,
	isMessageOfType,
	UIKind,
	IExtensionHostInitData,
} from "../deps/vscode/vs/workbench/services/extensions/common/extensionHostProtocol.js"
import { SocketCloseEvent, SocketCloseEventType } from "../deps/vscode/vs/base/parts/ipc/common/ipc.net.js"
import { IDisposable } from "../deps/vscode/vs/base/common/lifecycle.js"
import { URI } from "../deps/vscode/vs/base/common/uri.js"
import { RPCManager } from "./rpcManager.js"
import { ExtensionManager } from "./extensionManager.js"

// Get current file directory path
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Create ExtensionManager instance and register extension
const extensionManager = new ExtensionManager()
const rooCodeIdentifier = extensionManager.registerExtension("kilocode").identifier

// Declare extension host process variables
let extHostProcess: ReturnType<typeof fork>
let protocol: PersistentProtocol | null = null
let rpcManager: RPCManager | null = null

// Create socket server
const server = net.createServer((socket) => {
	console.log("Someone connected to main server")

	// Set socket noDelay option
	socket.setNoDelay(true)

	// Wrap socket with NodeSocket
	const nodeSocket = new NodeSocket(socket)

	// Listen for NodeSocket close events
	const closeDisposable: IDisposable = nodeSocket.onClose((event: SocketCloseEvent | undefined) => {
		console.log("NodeSocket close event received")
		if (event?.type === SocketCloseEventType.NodeSocketCloseEvent) {
			if (event.hadError) {
				console.error("Socket closed with error:", event.error)
			} else {
				console.log("Socket closed normally")
			}
		}
		closeDisposable.dispose()
	})

	// Create PersistentProtocol instance
	protocol = new PersistentProtocol({
		socket: nodeSocket,
		initialChunk: null,
	})

	// Set protocol message handler
	protocol.onMessage((message) => {
		if (isMessageOfType(message, MessageType.Ready)) {
			console.log("Extension host is ready")
			// Send initialization data
			const initData: IExtensionHostInitData = {
				commit: "development",
				version: "1.0.0",
				quality: undefined,
				parentPid: process.pid,
				environment: {
					isExtensionDevelopmentDebug: false,
					appName: "VSCodeAPIHook",
					appHost: "node",
					appLanguage: "en",
					appUriScheme: "vscode",
					appRoot: URI.file(__dirname),
					globalStorageHome: URI.file(path.join(__dirname, "globalStorage")),
					workspaceStorageHome: URI.file(path.join(__dirname, "workspaceStorage")),
					extensionDevelopmentLocationURI: undefined,
					extensionTestsLocationURI: undefined,
					useHostProxy: false,
					skipWorkspaceStorageLock: false,
					isExtensionTelemetryLoggingOnly: false,
				},
				workspace: {
					id: "development-workspace",
					name: "Development Workspace",
					transient: false,
					configuration: null,
					isUntitled: false,
				},
				remote: {
					authority: undefined,
					connectionData: null,
					isRemote: false,
				},
				extensions: {
					versionId: 1,
					allExtensions: extensionManager.getAllExtensionDescriptions(),
					myExtensions: extensionManager.getAllExtensionDescriptions().map((ext) => ext.identifier),
					activationEvents: extensionManager.getAllExtensionDescriptions().reduce(
						(events, ext) => {
							if (ext.activationEvents) {
								events[ext.identifier.value] = ext.activationEvents
							}
							return events
						},
						{} as { [extensionId: string]: string[] },
					),
				},
				telemetryInfo: {
					sessionId: "development-session",
					machineId: "development-machine",
					sqmId: "",
					devDeviceId: "",
					firstSessionDate: new Date().toISOString(),
					msftInternal: false,
				},
				logLevel: 0, // Info level
				loggers: [],
				logsLocation: URI.file(path.join(__dirname, "logs")),
				autoStart: true,
				consoleForward: {
					includeStack: false,
					logNative: false,
				},
				uiKind: UIKind.Desktop,
			}
			protocol?.send(VSBuffer.fromString(JSON.stringify(initData)))
		} else if (isMessageOfType(message, MessageType.Initialized)) {
			console.log("Extension host initialized")
			// Create RPCManager instance
			rpcManager = new RPCManager(protocol!, extensionManager)

			rpcManager.startInitialize()

			// Activate rooCode plugin
			const rpcProtocol = rpcManager.getRPCProtocol()
			if (rpcProtocol) {
				extensionManager.activateExtension(rooCodeIdentifier.value, rpcProtocol).catch((error: Error) => {
					console.error("Failed to load rooCode plugin:", error)
				})
			} else {
				console.error("Failed to get RPCProtocol from RPCManager")
			}
		}
	})
})

function startExtensionHostProcess() {
	process.env.VSCODE_DEBUG = "true"
	let nodeOptions = process.env.VSCODE_DEBUG ? `--inspect-brk=9229` : `--inspect=${DEBUG_PORT}`
	console.log("will start extension host process with options:", nodeOptions)

	// Create extension host process and pass environment variables
	extHostProcess = fork(path.join(__dirname, "extension.js"), [], {
		env: {
			...process.env,
			VSCODE_EXTHOST_WILL_SEND_SOCKET: "1",
			VSCODE_EXTHOST_SOCKET_HOST: "127.0.0.1",
			VSCODE_EXTHOST_SOCKET_PORT: (server.address() as net.AddressInfo)?.port?.toString() || "0",
			NODE_OPTIONS: nodeOptions,
		},
	})

	// Handle extension host process exit
	extHostProcess.on("exit", (code: number | null, signal: string | null) => {
		console.log(`Extension host process exited with code ${code} and signal ${signal}`)
		server.close()
	})
}

// Listen on random port
server.listen(0, "127.0.0.1", () => {
	const address = server.address()
	if (address && typeof address !== "string") {
		console.log(`Server listening on port ${address.port}`)
		startExtensionHostProcess()
	}
})

// Handle process exit
process.on("SIGINT", () => {
	console.log("Cleaning up...")
	if (protocol) {
		protocol.send(createMessageOfType(MessageType.Terminate))
	}
	server.close()
	if (extHostProcess) {
		extHostProcess.kill()
	}
	process.exit(0)
})
