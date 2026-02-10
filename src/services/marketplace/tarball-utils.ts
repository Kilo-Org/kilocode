// kilocode_change - new file
import * as tarFs from "tar-fs"
import * as zlib from "zlib"
import * as os from "os"
import * as path from "path"
import * as fs from "fs/promises"
import { createReadStream } from "fs"
import { pipeline } from "stream/promises"

/**
 * Download and extract a tarball to the destination directory.
 * Uses strip: 1 to remove the top-level directory from the tarball.
 * Rolls back (removes destDir) if extraction fails.
 */
export async function extractTarball(tarballUrl: string, destDir: string): Promise<void> {
	// Download tarball
	const response = await fetch(tarballUrl)
	if (!response.ok) {
		throw new Error(`Failed to fetch skill tarball: ${response.statusText}`)
	}

	// Write to temp file
	const tempFile = path.join(os.tmpdir(), `skill-${Date.now()}.tar.gz`)
	const buffer = Buffer.from(await response.arrayBuffer())
	await fs.writeFile(tempFile, buffer)

	// Track if extraction started (for rollback on failure)
	let extractionStarted = false

	try {
		await fs.mkdir(destDir, { recursive: true })
		extractionStarted = true

		// Extract tarball with strip: 1 to remove top-level directory
		await pipeline(createReadStream(tempFile), zlib.createGunzip(), tarFs.extract(destDir, { strip: 1 }))

		// Verify SKILL.md exists
		await fs.access(path.join(destDir, "SKILL.md"))
	} catch (error) {
		// Rollback: remove partially extracted directory
		if (extractionStarted) {
			await fs.rm(destDir, { recursive: true }).catch(() => {})
		}
		throw error
	} finally {
		// Clean up temp file
		await fs.unlink(tempFile).catch(() => {})
	}
}
