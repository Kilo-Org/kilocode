import { createTRPCProxyClient, httpBatchLink } from "@trpc/client"
import superjson from "superjson"

import type { User, Org } from "./types.js"

export interface ClientConfig {
	url: string
	authToken: string
}

export interface RooClient {
	auth: {
		me: {
			query: () => Promise<{ type: "user"; user: User } | { type: "org"; org: Org } | null>
		}
	}
}

export const createClient = ({ url, authToken }: ClientConfig): RooClient => {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	return createTRPCProxyClient<any>({
		links: [
			httpBatchLink({
				url: `${url}/trpc`,
				transformer: superjson,
				headers: () => (authToken ? { Authorization: `Bearer ${authToken}` } : {}),
			}),
		],
	}) as unknown as RooClient
}
