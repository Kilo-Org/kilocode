import { useManagedIndexerState } from "./useManagedIndexerState"

export function useManagedCodeIndexingEnabled() {
	const state = useManagedIndexerState()
	return state.isEnabled
}
