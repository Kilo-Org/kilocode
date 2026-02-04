import pMap from "p-map"

import { EVALS_REPO_PATH, exerciseLanguages, getExercisesForLanguage } from "../exercises/index"
import { createRun, createTask } from "../db/index"

import { runEvals } from "./runEvals"

export const runCi = async ({
	concurrency = 1,
	exercisesPerLanguage,
}: {
	concurrency?: number
	exercisesPerLanguage?: number
} = {}) => {
	console.log("Running evals in CI mode.")

	const run = await createRun({ model: "anthropic/claude-sonnet-4", socketPath: "", concurrency })

	for (const language of exerciseLanguages) {
		let exercises = await getExercisesForLanguage(EVALS_REPO_PATH, language)

		if (exercisesPerLanguage) {
			exercises = exercises.slice(0, exercisesPerLanguage)
		}

		await pMap(exercises, (exercise) => createTask({ runId: run.id, language, exercise }), { concurrency })
	}

	await runEvals(run.id)
}
