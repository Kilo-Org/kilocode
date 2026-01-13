export const AgenticaConstants = {
    BASE_URL: "https://api.agentica.dev",
    LOGIN_ENDPOINT: "/auth/login",
    UPGRADE_ENDPOINT: "/billing/upgrade",
    STATUS_ENDPOINT: "/user/status",
    REFRESH_ENDPOINT: "/auth/refresh",
    
    // OAuth settings
    OAUTH_CLIENT_ID: "agentica-vscode",
    OAUTH_SCOPE: "openid profile email",
    
    // API settings
    API_VERSION: "v1",
    DEFAULT_TIMEOUT: 30000, // 30 seconds
    
    // Error messages
    ERRORS: {
        NOT_AUTHENTICATED: "Not authenticated",
        NETWORK_ERROR: "Network error",
        INVALID_CREDENTIALS: "Invalid credentials",
        UPGRADE_FAILED: "Upgrade failed",
        STATUS_CHECK_FAILED: "Status check failed"
    }
} as const