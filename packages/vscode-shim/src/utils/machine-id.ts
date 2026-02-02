/**
 * Machine ID generation
 * Simple implementation to replace node-machine-id dependency
 */

import * as fs from "fs"
import * as path from "path"
import * as crypto from "crypto"
import * as os from "os"
import { ensureDirectoryExists } from "./paths.js"

/**
 * Get or create a unique machine ID
 * Stores in ~/.vscode-mock/.machine-id for persistence
 */
export function machineIdSync(): string {
	const homeDir = process.env.HOME || process.env.USERPROFILE || "."
	const idPath = path.join(homeDir, ".vscode-mock", ".machine-id")

	// Try to read existing ID
	try {
		if (fs.existsSync(idPath)) {
			return fs.readFileSync(idPath, "utf-8").trim()
		}
	} catch {
		// Fall through to generate new ID
	}

	// Generate new ID based on hostname and random data
	const hostname = os.hostname()
	const randomData = crypto.randomBytes(16).toString("hex")
	const machineId = crypto.createHash("sha256").update(`${hostname}-${randomData}`).digest("hex")

	// Save for future use
	try {
		const dir = path.dirname(idPath)
		ensureDirectoryExists(dir)
		fs.writeFileSync(idPath, machineId)
	} catch {
		// Ignore save errors
	}

	return machineId
}
