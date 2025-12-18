import { z } from "zod"

import type { Keys, Equals, AssertEqual } from "./type-fu.js"

/**
 * ExperimentId
 */

const kilocodeExperimentIds = ["morphFastApply", "speechToText"] as const // kilocode_change
export const experimentIds = [
	"powerSteering",
	"multiFileApplyDiff",
	"preventFocusDisruption",
	"imageGeneration",
	"runSlashCommand",
	"multipleNativeToolCalls",
] as const

export const experimentIdsSchema = z.enum([...experimentIds, ...kilocodeExperimentIds])

export type ExperimentId = z.infer<typeof experimentIdsSchema>

/**
 * Experiments
 */

export const experimentsSchema = z.object({
	morphFastApply: z.boolean().optional(), // kilocode_change
	speechToText: z.boolean().optional(), // kilocode_change
	powerSteering: z.boolean().optional(),
	multiFileApplyDiff: z.boolean().optional(),
	preventFocusDisruption: z.boolean().optional(),
	imageGeneration: z.boolean().optional(),
	runSlashCommand: z.boolean().optional(),
	multipleNativeToolCalls: z.boolean().optional(),
})

export type Experiments = z.infer<typeof experimentsSchema>

type _AssertExperiments = AssertEqual<Equals<ExperimentId, Keys<Experiments>>>
