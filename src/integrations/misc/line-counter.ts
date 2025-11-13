import fs, { createReadStream } from "fs"
import { createInterface } from "readline"
import { countTokens } from "../../utils/countTokens"
import { Anthropic } from "@anthropic-ai/sdk"

/**
 * Efficiently counts lines in a file using streams without loading the entire file into memory
 *
 * @param filePath - Path to the file to count lines in
 * @returns A promise that resolves to the number of lines in the file
 */
export async function countFileLines(filePath: string): Promise<number> {
	// Check if file exists
	try {
		await fs.promises.access(filePath, fs.constants.F_OK)
	} catch (error) {
		throw new Error(`File not found: ${filePath}`)
	}

	return new Promise((resolve, reject) => {
		let lineCount = 0

		const readStream = createReadStream(filePath)
		const rl = createInterface({
			input: readStream,
			crlfDelay: Infinity,
		})

		rl.on("line", () => {
			lineCount++
		})

		rl.on("close", () => {
			resolve(lineCount)
		})

		rl.on("error", (err) => {
			reject(err)
		})

		readStream.on("error", (err) => {
			reject(err)
		})
	})
}

export interface LineAndTokenCountResult {
	/** Total number of lines counted */
	lineCount: number
	/** Estimated token count */
	tokenEstimate: number
	/** Whether the full file was scanned (false if early exit occurred) */
	complete: boolean
}

export interface LineAndTokenCountOptions {
	/** Maximum tokens allowed before early exit. If undefined, scans entire file */
	budgetTokens?: number
	/** Number of lines to buffer before running token estimation (default: 256) */
	chunkLines?: number
}

/**
 * Efficiently counts lines and estimates tokens in a file using streams with incremental token estimation.
 * Processes file in chunks to avoid memory issues and can early-exit when budget is exceeded.
 *
 * @param filePath - Path to the file to analyze
 * @param options - Configuration options for counting
 * @returns A promise that resolves to line count, token estimate, and completion status
 */
export async function countFileLinesAndTokens(
	filePath: string,
	options: LineAndTokenCountOptions = {},
): Promise<LineAndTokenCountResult> {
	const { budgetTokens, chunkLines = 256 } = options

	// Check if file exists
	try {
		await fs.promises.access(filePath, fs.constants.F_OK)
	} catch (error) {
		throw new Error(`File not found: ${filePath}`)
	}

	return new Promise((resolve, reject) => {
		let lineCount = 0
		let tokenEstimate = 0
		let lineBuffer: string[] = []
		let complete = true
		let isProcessing = false
		let shouldClose = false

		const readStream = createReadStream(filePath)
		const rl = createInterface({
			input: readStream,
			crlfDelay: Infinity,
		})

		const processBuffer = async () => {
			if (lineBuffer.length === 0) return

			const bufferText = lineBuffer.join("\n")
			lineBuffer = [] // Clear buffer before processing

			try {
				const contentBlocks: Anthropic.Messages.ContentBlockParam[] = [{ type: "text", text: bufferText }]
				const chunkTokens = await countTokens(contentBlocks)
				tokenEstimate += chunkTokens
			} catch (error) {
				// On tokenizer error, use conservative estimate: 2 char ≈ 1 token
				tokenEstimate += Math.ceil(bufferText.length / 2)
			}

			// Check if we've exceeded budget
			if (budgetTokens !== undefined && tokenEstimate > budgetTokens) {
				complete = false
				shouldClose = true
				rl.close()
				readStream.destroy()
			}
		}

		rl.on("line", (line) => {
			lineCount++
			lineBuffer.push(line)

			// Process buffer when it reaches chunk size
			if (lineBuffer.length >= chunkLines && !isProcessing) {
				isProcessing = true
				rl.pause()
				processBuffer()
					.then(() => {
						isProcessing = false
						if (!shouldClose) {
							rl.resume()
						}
					})
					.catch((err) => {
						isProcessing = false
						reject(err)
					})
			}
		})

		rl.on("close", async () => {
			// Wait for any ongoing processing to complete
			while (isProcessing) {
				await new Promise((r) => setTimeout(r, 10))
			}

			// Process any remaining lines in buffer
			try {
				await processBuffer()
				resolve({ lineCount, tokenEstimate, complete })
			} catch (err) {
				reject(err)
			}
		})

		rl.on("error", (err) => {
			reject(err)
		})

		readStream.on("error", (err) => {
			reject(err)
		})
	})
}
