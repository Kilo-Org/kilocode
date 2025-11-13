// kilocode_change - new file
import { z } from "zod"

/**
 * Kilo Code Organization Settings Schema
 * These settings control organization-level features and configurations
 */
export const KiloOrganizationSettingsSchema = z.object({
	model_allow_list: z.array(z.string()).optional(),
	provider_allow_list: z.array(z.string()).optional(),
	default_model: z.string().optional(),
	data_collection: z.enum(["allow", "deny"]).nullable().optional(),
	// null means they were grandfathered in and so they have usage limits enabled
	enable_usage_limits: z.boolean().optional(),
	code_indexing_enabled: z.boolean().optional(),
	projects_ui_enabled: z.boolean().optional(),
})

export type KiloOrganizationSettings = z.infer<typeof KiloOrganizationSettingsSchema>

/**
 * Kilo Code Organization Schema
 * Represents the full organization object returned from the API
 */
export const KiloOrganizationSchema = z.object({
	id: z.string(),
	name: z.string(),
	created_at: z.string(),
	updated_at: z.string(),
	microdollars_balance: z.number(),
	microdollars_used: z.number(),
	stripe_customer_id: z.string().nullable(),
	auto_top_up_enabled: z.boolean(),
	settings: KiloOrganizationSettingsSchema,
	seat_count: z.number().min(0).default(0),
	require_seats: z.boolean().default(false),
	created_by_kilo_user_id: z.string().nullable(),
	deleted_at: z.string().nullable(),
	sso_domain: z.string().nullable(),
	plan: z.enum(["teams", "enterprise"]),
})

export type KiloOrganization = z.infer<typeof KiloOrganizationSchema>
