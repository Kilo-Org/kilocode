// kilocode_change - new file

import { parentPort, workerData } from "worker_threads"
import { ParserService } from "../services/parser/parser-service"
import { DatabaseManager } from "../services/storage/database-manager"
import { loadRequiredLanguageParsers } from "../services/tree-sitter/languageParser"

interface WorkerMessage {
	type: "parse" | "dispose"
	id: string
	data: any
}

interface WorkerResponse {
	type: "result" | "error" | "ready"
	id: string
	data: any
}

let parserService: ParserService | null = null
let databaseManager: DatabaseManager | null = null

async function initializeWorker() {
	try {
		// Initialize database manager with placeholder paths
		databaseManager = new DatabaseManager("/tmp", "/tmp")
		await databaseManager.initialize()

		// Initialize parser service
		parserService = new ParserService(databaseManager, {
			enableIncrementalParsing: true,
			maxWorkers: 0, // No nested workers
			supportedLanguages: ["python", "javascript", "typescript", "xml", "json"],
		})

		// Load language parsers
		const languageParsers = await loadRequiredLanguageParsers([])
		await parserService.initialize([])

		// Signal ready
		parentPort?.postMessage({
			type: "ready",
			id: "init",
			data: { status: "ready" },
		} as WorkerResponse)
	} catch (error) {
		parentPort?.postMessage({
			type: "error",
			id: "init",
			data: { error: error instanceof Error ? error.message : String(error) },
		} as WorkerResponse)
	}
}

async function handleParseMessage(message: WorkerMessage & { type: "parse" }) {
	if (!parserService || !databaseManager) {
		throw new Error("Worker not initialized")
	}

	const { filePath, content, force } = message.data

	try {
		const result = await parserService.parseFile(filePath, { content, force })

		parentPort?.postMessage({
			type: "result",
			id: message.id,
			data: result,
		} as WorkerResponse)
	} catch (error) {
		parentPort?.postMessage({
			type: "error",
			id: message.id,
			data: { error: error instanceof Error ? error.message : String(error) },
		} as WorkerResponse)
	}
}

async function handleDisposeMessage() {
	try {
		if (parserService) {
			await parserService.dispose()
		}
		if (databaseManager) {
			await databaseManager.close()
		}

		parentPort?.postMessage({
			type: "result",
			id: "dispose",
			data: { status: "disposed" },
		} as WorkerResponse)
	} catch (error) {
		parentPort?.postMessage({
			type: "error",
			id: "dispose",
			data: { error: error instanceof Error ? error.message : String(error) },
		} as WorkerResponse)
	}
}

// Message handler
parentPort?.on("message", async (message: WorkerMessage) => {
	switch (message.type) {
		case "parse":
			await handleParseMessage(message as WorkerMessage & { type: "parse" })
			break
		case "dispose":
			await handleDisposeMessage()
			break
		default:
			parentPort?.postMessage({
				type: "error",
				id: message.id,
				data: { error: `Unknown message type: ${(message as any).type}` },
			} as WorkerResponse)
	}
})

// Initialize worker
initializeWorker().catch((error) => {
	parentPort?.postMessage({
		type: "error",
		id: "init",
		data: { error: error instanceof Error ? error.message : String(error) },
	} as WorkerResponse)
})
