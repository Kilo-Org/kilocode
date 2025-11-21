/**
 * Session-specific state atoms
 * These atoms manage session state including session ID
 */

import { atom } from "jotai"

/**
 * Atom to hold the current session ID
 * This is set by the SessionService when a session is created or restored
 */
export const sessionIdAtom = atom<string | null>(null)
