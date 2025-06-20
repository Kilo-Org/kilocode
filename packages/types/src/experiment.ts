import { z } from "zod"

import type { Keys, Equals, AssertEqual } from "./type-fu.js"

/**
 * ExperimentId
 */

const kilocodeExperimentIds = ["autocomplete"]
export const experimentIds = ["powerSteering", "disableCompletionCommand", "multiFileApplyDiff", ...kilocodeExperimentIds] as const

export const experimentIdsSchema = z.enum(experimentIds)

export type ExperimentId = z.infer<typeof experimentIdsSchema>

/**
 * Experiments
 */

export const experimentsSchema = z.object({
	powerSteering: z.boolean().optional(),
	disableCompletionCommand: z.boolean().optional(),
	multiFileApplyDiff: z.boolean().optional(),
	autocomplete: z.boolean(), // kilocode_change
})

export type Experiments = z.infer<typeof experimentsSchema>

type _AssertExperiments = AssertEqual<Equals<ExperimentId, Keys<Experiments>>>
