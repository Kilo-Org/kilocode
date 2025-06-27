import { z } from "zod"

import type { Keys, Equals, AssertEqual } from "./type-fu.js"

/**
 * ExperimentId
 */

const kilocodeExperimentIds = ["autocomplete"] as const
export const experimentIds = ["powerSteering", "multiFileApplyDiff"] as const

export const experimentIdsSchema = z.enum([...experimentIds, ...kilocodeExperimentIds])

export type ExperimentId = z.infer<typeof experimentIdsSchema>

/**
 * Experiments
 */

export const experimentsSchema = z.object({
	powerSteering: z.boolean().optional(),
	multiFileApplyDiff: z.boolean().optional(),
	autocomplete: z.boolean(), // kilocode_change
})

export type Experiments = z.infer<typeof experimentsSchema>

type _AssertExperiments = AssertEqual<Equals<ExperimentId, Keys<Experiments>>>
