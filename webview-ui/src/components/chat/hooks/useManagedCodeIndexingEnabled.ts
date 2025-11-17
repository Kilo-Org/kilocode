import { useExtensionState } from "../../../context/ExtensionStateContext"

const enabledCodeIndexOrgs = [
	// kilo local (bmc)
	"0e4c8216-9a79-4f25-a196-84bd58dec6ed",
	// kilo prod
	"9d278969-5453-4ae3-a51f-a8d2274a7b56",
]

export function useManagedCodeIndexingEnabled() {
	const { apiConfiguration } = useExtensionState()

	// Check if organization indexing is available
	const orgId = String(apiConfiguration?.kilocodeOrganizationId || "")
	return enabledCodeIndexOrgs.includes(orgId)
}
