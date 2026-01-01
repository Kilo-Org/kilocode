// kilocode_change - new file

export type ThinkingState =
	| "idle"
	| "analyzing"
	| "planning"
	| "executing"
	| "reflecting"
	| "healing"
	| "waiting_user"
	| "paused"
	| "completed"
	| "error"

export interface StateEvent {
	type: string
	timestamp: number
	payload?: Record<string, unknown>
}

export interface DecisionLogEntry {
	id: string
	timestamp: number
	state: ThinkingState
	decision: string
	reasoning: string
	context?: Record<string, unknown>
}

export interface ThinkingStateStore {
	// State
	state: ThinkingState
	previousState: ThinkingState | null
	decisionLogs: DecisionLogEntry[]
	events: StateEvent[]
	isPaused: boolean
	pauseReason: string | null

	// Actions
	setState(newState: ThinkingState): void
	pause(reason?: string): void
	resume(): void
	logDecision(decision: string, reasoning: string, context?: Record<string, unknown>): void
	addEvent(type: string, payload?: Record<string, unknown>): void
	clearLogs(): void
	undo(): boolean

	// Getters
	getState(): ThinkingState
	getDecisionLogs(): DecisionLogEntry[]
	getEvents(): StateEvent[]
	isThinking(): boolean
}

class ThinkingStateManager implements ThinkingStateStore {
	private _state: ThinkingState = "idle"
	private _previousState: ThinkingState | null = null
	private _decisionLogs: DecisionLogEntry[] = []
	private _events: StateEvent[] = []
	private _isPaused: boolean = false
	private _pauseReason: string | null = null
	private listeners: Set<(state: ThinkingState) => void> = new Set()
	private maxLogs: number = 100

	setState(newState: ThinkingState): void {
		if (this._isPaused && newState !== "paused") {
			console.warn("Cannot change state while paused")
			return
		}

		this._previousState = this._state
		this._state = newState

		this.addEvent("state_change", { from: this._previousState, to: newState })
		this.notifyListeners()
	}

	get state(): ThinkingState {
		return this._state
	}

	get previousState(): ThinkingState | null {
		return this._previousState
	}

	get decisionLogs(): DecisionLogEntry[] {
		return this._decisionLogs
	}

	get events(): StateEvent[] {
		return this._events
	}

	get isPaused(): boolean {
		return this._isPaused
	}

	get pauseReason(): string | null {
		return this._pauseReason
	}

	pause(reason: string = "User requested pause"): void {
		this._isPaused = true
		this._pauseReason = reason
		this.setState("paused")
		this.addEvent("pause", { reason })
	}

	resume(): void {
		if (!this._isPaused) {
			return
		}

		this._isPaused = false
		this._pauseReason = null
		this.setState(this._previousState ?? "analyzing")
		this.addEvent("resume", {})
	}

	logDecision(decision: string, reasoning: string, context?: Record<string, unknown>): void {
		const entry: DecisionLogEntry = {
			id: `decision-${Date.now()}-${Math.random().toString(36).slice(2)}`,
			timestamp: Date.now(),
			state: this._state,
			decision,
			reasoning,
			context,
		}

		this._decisionLogs.push(entry)

		// Trim logs if exceeding max
		if (this._decisionLogs.length > this.maxLogs) {
			this._decisionLogs = this._decisionLogs.slice(-this.maxLogs)
		}

		this.addEvent("decision_logged", { decisionId: entry.id })
	}

	addEvent(type: string, payload?: Record<string, unknown>): void {
		const event: StateEvent = {
			type,
			timestamp: Date.now(),
			payload,
		}

		this._events.push(event)

		// Trim events if exceeding max
		if (this._events.length > this.maxLogs) {
			this._events = this._events.slice(-this.maxLogs)
		}
	}

	clearLogs(): void {
		this._decisionLogs = []
		this._events = []
		this.addEvent("logs_cleared", {})
	}

	undo(): boolean {
		if (this._decisionLogs.length === 0) {
			return false
		}

		const lastLog = this._decisionLogs.pop()
		if (lastLog) {
			this.addEvent("undo", { undoneDecisionId: lastLog.id })
			return true
		}
		return false
	}

	getState(): ThinkingState {
		return this._state
	}

	getDecisionLogs(): DecisionLogEntry[] {
		return [...this._decisionLogs]
	}

	getEvents(): StateEvent[] {
		return [...this._events]
	}

	isThinking(): boolean {
		return ["analyzing", "planning", "executing", "reflecting", "healing"].includes(this._state)
	}

	// Subscribe to state changes
	subscribe(listener: (state: ThinkingState) => void): () => void {
		this.listeners.add(listener)
		return () => this.listeners.delete(listener)
	}

	private notifyListeners(): void {
		for (const listener of this.listeners) {
			listener(this._state)
		}
	}

	// Snapshot for persistence
	getSnapshot(): {
		state: ThinkingState
		decisionLogs: DecisionLogEntry[]
		timestamp: number
	} {
		return {
			state: this._state,
			decisionLogs: this._decisionLogs,
			timestamp: Date.now(),
		}
	}

	// Restore from snapshot
	restoreSnapshot(snapshot: { state: ThinkingState; decisionLogs: DecisionLogEntry[] }): void {
		this._state = snapshot.state
		this._decisionLogs = snapshot.decisionLogs
		this.addEvent("snapshot_restored", { timestamp: Date.now() })
	}

	// Reset to initial state
	reset(): void {
		this._state = "idle"
		this._previousState = null
		this._decisionLogs = []
		this._events = []
		this._isPaused = false
		this._pauseReason = null
		this.notifyListeners()
	}
}

// Singleton instance
let instance: ThinkingStateManager | null = null

export function getThinkingStateManager(): ThinkingStateManager {
	if (!instance) {
		instance = new ThinkingStateManager()
	}
	return instance
}

export function createThinkingStateManager(): ThinkingStateManager {
	return new ThinkingStateManager()
}
