import { useMemo } from "react"
import { useAtomValue } from "jotai"
import { availableModesAtom } from "../state/atoms/modes"
import { type DropdownOption, DropdownOptionType } from "../../../components/ui/select-dropdown"

interface UseModeOptionsParams {
	/** Optional label for the organization modes header (defaults to "Organization Modes") */
	organizationModesLabel?: string
}

/**
 * Hook to build mode dropdown options from available modes.
 * Shared between ModeSelector (new sessions) and SessionModeSelector (running sessions).
 *
 * @param params.organizationModesLabel - Optional translated label for organization modes header
 * @returns Array of dropdown options for the mode selector
 */
export function useModeOptions(_params?: UseModeOptionsParams): DropdownOption[] {
	const availableModes = useAtomValue(availableModesAtom)
	// TODO: Re-enable when organization modes are supported
	// const organizationModesLabel = params?.organizationModesLabel ?? "Organization Modes"

	return useMemo(() => {
		if (!availableModes || availableModes.length === 0) return []

		const opts: DropdownOption[] = []

		// TODO: Organization modes are temporarily disabled in Agent Manager
		// Disabled for now and will be re-enabled when organization modes are supported in agent manager
		const otherModes = availableModes.filter((mode) => mode.source !== "organization")

		// Add other modes (excluding organization modes for now)
		opts.push(
			...otherModes.map((mode) => ({
				value: mode.slug,
				label: mode.name,
				description: mode.description,
				type: DropdownOptionType.ITEM,
			})),
		)

		return opts
	}, [availableModes])
}
