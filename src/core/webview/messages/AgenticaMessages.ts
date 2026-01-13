export const AgenticaMessages = {
    // Login related messages
    LOGIN_REQUEST: "agentica:login:request",
    LOGIN_RESPONSE: "agentica:login:response",
    
    // Upgrade related messages
    UPGRADE_REQUEST: "agentica:upgrade:request",
    UPGRADE_RESPONSE: "agentica:upgrade:response",
    
    // Status related messages
    GET_STATUS: "agentica:status:get",
    STATUS_RESPONSE: "agentica:status:response",
    
    // Logout related messages
    LOGOUT_REQUEST: "agentica:logout:request",
    LOGOUT_RESPONSE: "agentica:logout:response",
    
    // Provider events
    PROVIDER_READY: "agentica:provider:ready",
    PROVIDER_ERROR: "agentica:provider:error",
    
    // User events
    USER_UPDATED: "agentica:user:updated",
    SUBSCRIPTION_UPDATED: "agentica:subscription:updated"
} as const

// Type for message types
export type AgenticaMessageType = typeof AgenticaMessages[keyof typeof AgenticaMessages]