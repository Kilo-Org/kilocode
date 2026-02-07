export interface User {
	id: string
	name: string
	email: string
	imageUrl: string | null
	entity: {
		id: string
		username: string | null
		image_url: string
		last_name: string
		first_name: string
		email_addresses: { email_address: string }[]
		public_metadata: Record<string, unknown>
	}
	publicMetadata: Record<string, unknown>
	stripeCustomerId: string | null
	lastSyncAt: string
	deletedAt: string | null
	createdAt: string
	updatedAt: string
}

export interface Org {
	id: string
	name: string
	slug: string
	imageUrl: string | null
	createdAt: string
	updatedAt: string
	deletedAt: string | null
}
