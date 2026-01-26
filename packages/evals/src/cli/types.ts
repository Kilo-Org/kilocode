import { type TaskEvent } from "@roo-code/types"

import type { Run, Task } from "../db/index.js"
import { Logger } from "./utils.js"

export class SubprocessTimeoutError extends Error {
	constructor(timeout: number) {
		super(`Subprocess timeout after ${timeout}ms`)
		this.name = "SubprocessTimeoutError"
	}
}

export type RunTaskOptions = {
	run: Run
	task: Task
	jobToken: string | null
	publish: (taskEvent: TaskEvent) => Promise<void>
	logger: Logger
}
