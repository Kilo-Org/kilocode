import { z } from "zod"

import type { Keys, Equals, AssertEqual } from "./type-fu.js"

/**
 * ExperimentId
 */

const kilocodeExperimentIds = ["inlineAssist"] as const // kilocode_change
export const experimentIds = ["powerSteering", "multiFileApplyDiff"] as const

export const experimentIdsSchema = z.enum([...experimentIds, ...kilocodeExperimentIds])

export type ExperimentId = z.infer<typeof experimentIdsSchema>

/**
 * Experiments
 */

export const experimentsSchema = z.object({
	powerSteering: z.boolean().optional(),
	multiFileApplyDiff: z.boolean().optional(),
	inlineAssist: z.boolean().optional(), // kilocode_change
})

export type Experiments = z.infer<typeof experimentsSchema>

type _AssertExperiments = AssertEqual<Equals<ExperimentId, Keys<Experiments>>>
