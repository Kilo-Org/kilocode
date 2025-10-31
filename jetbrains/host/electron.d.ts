// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

import { MessageEvent } from "electron"

declare global {
	interface Process {
		/**
		 * Electron's process.crash() method
		 * This method is used to crash the process
		 */
		crash(): void

		/**
		 * Electron's IPC (Inter-Process Communication) port
		 * Used for communication between renderer and main processes
		 */
		parentPort: {
			/**
			 * Register a listener for a specific channel
			 */
			on(channel: string, listener: (event: MessageEvent) => void): void

			/**
			 * Register a one-time listener for a specific channel
			 */
			once(channel: string, listener: (event: MessageEvent) => void): void

			/**
			 * Send a message to the parent process
			 */
			postMessage(message: any): void
		}
	}
}

export {}
