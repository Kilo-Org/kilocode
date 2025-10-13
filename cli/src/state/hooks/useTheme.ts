/**
 * Hook to access the current theme based on config state
 */

import { useAtomValue } from "jotai"
import { themeAtom } from "../atoms/config.js"
import { getThemeById } from "../../constants/themes/index.js"
import type { Theme } from "../../types/theme.js"

/**
 * Hook to get the current theme
 * @returns The current theme object
 */
export function useTheme(): Theme {
	const themeId = useAtomValue(themeAtom)
	return getThemeById(themeId)
}
