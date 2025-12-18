import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import * as fs from "node:fs"
import * as path from "node:path"
import archiver from "archiver"

import { findRun, getTasks } from "@roo-code/evals"

export const dynamic = "force-dynamic"

const LOG_BASE_PATH = "/tmp/evals/runs"

// Sanitize path components to prevent path traversal attacks
function sanitizePathComponent(component: string): string {
	// Remove any path separators, null bytes, and other dangerous characters
	return component.replace(/[/\\:\0*?"<>|]/g, "_")
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
	const { id } = await params

	try {
		const runId = Number(id)

		if (isNaN(runId)) {
			return NextResponse.json({ error: "Invalid run ID" }, { status: 400 })
		}

		// Verify the run exists
		await findRun(runId)

		// Get all tasks for this run
		const tasks = await getTasks(runId)

		// Filter for failed tasks only
		const failedTasks = tasks.filter((task) => task.passed === false)

		if (failedTasks.length === 0) {
			return NextResponse.json({ error: "No failed tasks to export" }, { status: 400 })
		}

		// Create a zip archive
		const archive = archiver("zip", { zlib: { level: 9 } })

		// Collect chunks to build the response
		const chunks: Buffer[] = []

		archive.on("data", (chunk: Buffer) => {
			chunks.push(chunk)
		})

		// Track archive errors
		let archiveError: Error | null = null
		archive.on("error", (err: Error) => {
			archiveError = err
		})

		// Set up the end promise before finalizing (proper event listener ordering)
		const archiveEndPromise = new Promise<void>((resolve, reject) => {
			archive.on("end", resolve)
			archive.on("error", reject)
		})

		// Add each failed task's log file to the archive
		const logDir = path.join(LOG_BASE_PATH, String(runId))
		let filesAdded = 0

		for (const task of failedTasks) {
			// Sanitize language and exercise to prevent path traversal
			const safeLanguage = sanitizePathComponent(task.language)
			const safeExercise = sanitizePathComponent(task.exercise)
			const logFileName = `${safeLanguage}-${safeExercise}.log`
			const logFilePath = path.join(logDir, logFileName)

			// Verify the resolved path is within the expected directory (defense in depth)
			const resolvedPath = path.resolve(logFilePath)
			const expectedBase = path.resolve(LOG_BASE_PATH)
			if (!resolvedPath.startsWith(expectedBase)) {
				continue // Skip files with suspicious paths
			}

			if (fs.existsSync(logFilePath)) {
				archive.file(logFilePath, { name: logFileName })
				filesAdded++
			}
		}

		// Check if any files were actually added
		if (filesAdded === 0) {
			archive.abort()
			return NextResponse.json(
				{ error: "No log files found - they may have been cleared from disk" },
				{ status: 404 },
			)
		}

		// Finalize the archive
		await archive.finalize()

		// Wait for all data to be collected
		await archiveEndPromise

		// Check for archive errors
		if (archiveError) {
			throw archiveError
		}

		// Combine all chunks into a single buffer
		const zipBuffer = Buffer.concat(chunks)

		// Return the zip file
		return new NextResponse(zipBuffer, {
			status: 200,
			headers: {
				"Content-Type": "application/zip",
				"Content-Disposition": `attachment; filename="run-${runId}-failed-logs.zip"`,
				"Content-Length": String(zipBuffer.length),
			},
		})
	} catch (error) {
		console.error("Error exporting failed logs:", error)

		if (error instanceof Error && error.name === "RecordNotFoundError") {
			return NextResponse.json({ error: "Run not found" }, { status: 404 })
		}

		return NextResponse.json({ error: "Failed to export logs" }, { status: 500 })
	}
}
