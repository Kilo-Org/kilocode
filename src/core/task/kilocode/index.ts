// kilocode_change - index file for kilocode task services

export { extractLatestUserQuery, formatCodeIndexContext } from "./codeIndexContext"

export {
	initializeKiloCodeServices,
	getKiloCodeServices,
	getServicesStatus,
	countTokensWithCache,
	storeConversationMemory,
	searchRelevantMemories,
	prioritizeContext,
	compressContext,
	searchUnifiedIndex,
	recordRelevanceFeedback,
	resetKiloCodeServices,
	type KiloCodeServices,
	type ServicesStatus,
} from "./services-integration"
