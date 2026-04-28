import { Permission } from "@/permission";
import { eq, desc, Database } from "@/storage/db";
import type { MessageV2 } from "./message-v2";
import { PartTable } from "./session.sql";
import type { Brand } from "effect/Brand";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** How many identical (tool, input) calls trigger a tool loop. */
const TOOL_THRESHOLD = 3;
/** How far back (in parts) to scan for repeated tool calls. */
const TOOL_SCAN_LIMIT = TOOL_THRESHOLD * 10;
/** How many recent completed text/reasoning parts to compare current text against. */
const TEXT_HISTORY_COUNT = 5;
/** Parts scanned when building the text history. */
const TEXT_SCAN_LIMIT = 60;
/** Minimum paragraph length (chars) worth comparing. */
const MIN_PARAGRAPH_LENGTH = 80;
/** Number of chars from the end of the text delta to consider for the within-stream loop signal. */
const LOOP_WINDOW = 500;

/**
 * Tools that indicate the agent is making genuine progress (modifying files).
 * If one of these appears between two identical tool calls, the run is reset —
 * the agent changed something, so it's a test-fix-test cycle, not a loop.
 */
const WRITE_TOOLS = new Set(["edit", "multiedit", "write", "apply_patch"]);

// ---------------------------------------------------------------------------
// Text / reasoning loop detection
// ---------------------------------------------------------------------------

type TextLoopResult =
	| { detected: false }
	| { detected: true; paragraph: string };

// ---------------------------------------------------------------------------
// LoopDetector class
// ---------------------------------------------------------------------------

/**
 * Loop-detector for a single processor session.
 */
export class LoopDetector {
	/** Whether any loop (text, reasoning, or tool) was detected this session. */
	detected = false;
	/** Timestamp when the loop was first detected. */
	stopTime = 0;
	/** True after a tool loop is rejected — the for-await loop should break. */
	shouldBreakStream = false;

	private readonly controller: AbortController;

	constructor(parentAbort: AbortSignal) {
		this.controller = new AbortController();
		parentAbort.addEventListener("abort", () => this.controller.abort(), {
			signal: parentAbort,
		});
	}

	/** AbortSignal that fires when a text/reasoning loop is detected. */
	get signal(): AbortSignal {
		return this.controller.signal;
	}

	/** Reset per-process() transient state; call at the top of each process() call. */
	resetForProcess() {
		this.shouldBreakStream = false;
	}

	/**
	 * Check for a repeated text or reasoning delta.
	 * Aborts the LLM stream automatically if a loop is detected.
	 *
	 * Signal 1 — within-stream window: two consecutive `window`-sized slices are identical.
	 * Signal 2 — cross-session paragraph: the last complete paragraph matches a paragraph
	 *   from recent text/reasoning history (only runs at \n\n boundaries to avoid DB queries
	 *   on every delta).
	 */
	async checkTextDelta(
		sessionID: string & Brand<"SessionID">,
		partID: string,
		text: string,
	): Promise<TextLoopResult> {
		// Signal 1: two consecutive identical windows within the current stream
		if (text.length >= LOOP_WINDOW * 2) {
			const recent = text.slice(-LOOP_WINDOW);
			const earlier = text.slice(-LOOP_WINDOW * 2, -LOOP_WINDOW);
			if (recent === earlier) {
				this.detected = true;
				this.stopTime = Date.now();
				this.controller.abort();
				return { detected: true, paragraph: recent };
			}
		}

		// Signal 2: cross-session paragraph check (only at paragraph boundaries)
		if (text.endsWith("\n\n")) {
			const paragraphs = (s: string) =>
				s
					.split(/\n\n+/)
					.map((p) => p.trim())
					.filter((p) => p.length >= MIN_PARAGRAPH_LENGTH);

			const currentParagraphs = paragraphs(text);
			if (currentParagraphs.length > 0) {
				const lastParagraph = currentParagraphs[currentParagraphs.length - 1];
				const rows = Database.use((db) =>
					db
						.select()
						.from(PartTable)
						.where(eq(PartTable.session_id, sessionID))
						.orderBy(desc(PartTable.id))
						.limit(TEXT_SCAN_LIMIT)
						.all(),
				);
				let scanned = 0;
				for (const row of rows) {
					const p = { ...row.data, id: row.id } as MessageV2.Part;
					if ((p.type !== "text" && p.type !== "reasoning") || p.id === partID)
						continue;
					if (scanned >= TEXT_HISTORY_COUNT) break;
					scanned++;
					const historical =
						p.type === "text"
							? (p as MessageV2.TextPart).text
							: (p as MessageV2.ReasoningPart).text;
					for (const para of paragraphs(historical)) {
						if (para === lastParagraph) {
							this.detected = true;
							this.stopTime = Date.now();
							this.controller.abort();
							return { detected: true, paragraph: lastParagraph };
						}
					}
				}
			}
		}

		return { detected: false };
	}

	/**
	 * Check for a repeated tool call. If detected, prompts the user via the
	 * doom_loop permission. If the user rejects, sets `shouldBreakStream = true`
	 * and returns `{ rejected: true, message }` so the caller can write the error
	 * onto the tool part. Returns `{ rejected: false }` when no loop or user allows.
	 */
	async checkToolCall(
		sessionID: string & Brand<"SessionID">,
		toolName: string,
		toolInput: unknown,
		agentPermission: Permission.Ruleset,
	): Promise<{ rejected: true; message: string } | { rejected: false }> {
		const rows = Database.use((db) =>
			db
				.select()
				.from(PartTable)
				.where(eq(PartTable.session_id, sessionID))
				.orderBy(desc(PartTable.id))
				.limit(TOOL_SCAN_LIMIT)
				.all(),
		).reverse(); // oldest → newest
		const inputStr = JSON.stringify(toolInput);
		const parts = rows.map(
			(r) =>
				({
					...r.data,
					id: r.id,
					sessionID: r.session_id,
					messageID: r.message_id,
				}) as MessageV2.Part,
		);
		let run = 0;
		let lastMatchIdx = -1;
		for (let i = 0; i < parts.length; i++) {
			const p = parts[i];
			if (p.type !== "tool") continue;
			const toolPart = p as MessageV2.ToolPart;
			const partInputStr =
				toolPart.state.status === "completed" ||
				toolPart.state.status === "error"
					? JSON.stringify(toolPart.state.input)
					: null;
			const isWriteTool = WRITE_TOOLS.has(p.tool);
			const isSameToolDifferentInput =
				p.tool === toolName &&
				partInputStr !== null &&
				partInputStr !== inputStr;
			if ((isWriteTool || isSameToolDifferentInput) && lastMatchIdx !== -1) {
				run = 0;
				lastMatchIdx = -1;
				continue;
			}
			if (
				(p.state.status === "completed" || p.state.status === "error") &&
				p.tool === toolName &&
				JSON.stringify(p.state.input) === inputStr
			) {
				run++;
				lastMatchIdx = i;
			}
		}

		if (run < TOOL_THRESHOLD - 1) return { rejected: false };

		const message = `Loop detected: "${toolName}" has been called ${run + 1} times with identical input. Please try a different approach to make progress.`;
		try {
			await Permission.ask({
				permission: "doom_loop",
				patterns: [toolName],
				sessionID,
				metadata: { tool: toolName, input: toolInput },
				always: [toolName],
				ruleset: agentPermission,
			});
			return { rejected: false };
		} catch (e) {
			if (
				e instanceof Permission.RejectedError ||
				e instanceof Permission.DeniedError
			) {
				this.shouldBreakStream = true;
				return { rejected: true, message };
			}
			throw e;
		}
	}

	/**
	 * Stamp loop metadata onto the assistant message before it is saved.
	 * Call this once at the end of process(), before Session.updateMessage().
	 */
	applyToMessage(message: MessageV2.Assistant) {
		if (!this.detected) return;
		message.structured = {
			...(message.structured ?? {}),
			loopDetected: true,
			loopStopTime: this.stopTime,
		};
	}
}
