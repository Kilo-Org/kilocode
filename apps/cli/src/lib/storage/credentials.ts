import fs from "fs/promises"
import path from "path"

import { getConfigDir } from "./index.js"

const CREDENTIALS_FILE = path.join(getConfigDir(), "cli-credentials.json")

export interface Credentials {
	token: string
	createdAt: string
	userId?: string
	orgId?: string
}

export async function saveToken(token: string, options?: { userId?: string; orgId?: string }): Promise<void> {
	await fs.mkdir(getConfigDir(), { recursive: true })

	const credentials: Credentials = {
		token,
		createdAt: new Date().toISOString(),
		userId: options?.userId,
		orgId: options?.orgId,
	}

	await fs.writeFile(CREDENTIALS_FILE, JSON.stringify(credentials, null, 2), {
		mode: 0o600, // Read/write for owner only
	})
}

export async function loadToken(): Promise<string | null> {
	try {
		const data = await fs.readFile(CREDENTIALS_FILE, "utf-8")
		const credentials: Credentials = JSON.parse(data)
		return credentials.token
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return null
		}
		throw error
	}
}

export async function loadCredentials(): Promise<Credentials | null> {
	try {
		const data = await fs.readFile(CREDENTIALS_FILE, "utf-8")
		return JSON.parse(data) as Credentials
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return null
		}
		throw error
	}
}

export async function clearToken(): Promise<void> {
	try {
		await fs.unlink(CREDENTIALS_FILE)
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
			throw error
		}
	}
}

export async function hasToken(): Promise<boolean> {
	const token = await loadToken()
	return token !== null
}

export function getCredentialsPath(): string {
	return CREDENTIALS_FILE
}
