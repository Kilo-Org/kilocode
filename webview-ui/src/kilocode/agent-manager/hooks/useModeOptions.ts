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
export function useModeOptions(params?: UseModeOptionsParams): DropdownOption[] {
	const availableModes = useAtomValue(availableModesAtom)
	const organizationModesLabel = params?.organizationModesLabel ?? "Organization Modes"

	return useMemo(() => {
		if (!availableModes || availableModes.length === 0) return []

		const opts: DropdownOption[] = []

		// Group organization modes separately if any exist
		const organizationModes = availableModes.filter((mode) => mode.source === "organization")
		const otherModes = availableModes.filter((mode) => mode.source !== "organization")

		// Add organization modes section if any exist
		if (organizationModes.length > 0) {
			opts.push({
				value: "org-header",
				label: organizationModesLabel,
				disabled: true,
				type: DropdownOptionType.SHORTCUT,
			})
			opts.push(
				...organizationModes.map((mode) => ({
					value: mode.slug,
					label: mode.name,
					description: mode.description,
					type: DropdownOptionType.ITEM,
				})),
			)
			opts.push({
				value: "sep-org",
				label: "separator",
				type: DropdownOptionType.SEPARATOR,
			})
		}

		// Add other modes
		opts.push(
			...otherModes.map((mode) => ({
				value: mode.slug,
				label: mode.name,
				description: mode.description,
				type: DropdownOptionType.ITEM,
			})),
		)

		return opts
	}, [availableModes, organizationModesLabel])
}
