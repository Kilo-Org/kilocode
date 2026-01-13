import { useState, useEffect, useCallback } from "react"
import { AgenticaTypes } from "../../../../src/core/types/AgenticaTypes"
import { AgenticaMessages } from "../../../../src/core/webview/messages/AgenticaMessages"
import { WebviewMessage } from "../../../../src/shared/WebviewMessage"

export function useAgentica() {
    const [status, setStatus] = useState<AgenticaTypes.StatusResponse | null>(null)
    const [isLoading, setIsLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        // Get initial status
        getStatus()
    }, [])

    const sendMessage = useCallback((type: string, data?: any) => {
        const message: WebviewMessage = { type, data }
        window.vscode?.postMessage(message)
    }, [])

    const handleMessage = useCallback((event: MessageEvent) => {
        const message = event.data as WebviewMessage
        
        switch (message.type) {
            case AgenticaMessages.LOGIN_RESPONSE:
                setIsLoading(false)
                if (message.error) {
                    setError(message.error)
                } else {
                    setError(null)
                    setStatus(message.data)
                }
                break
                
            case AgenticaMessages.UPGRADE_RESPONSE:
                setIsLoading(false)
                if (message.error) {
                    setError(message.error)
                } else {
                    setError(null)
                    // Refresh status after upgrade
                    getStatus()
                }
                break
                
            case AgenticaMessages.STATUS_RESPONSE:
                setIsLoading(false)
                if (message.error) {
                    setError(message.error)
                } else {
                    setError(null)
                    setStatus(message.data)
                }
                break
        }
    }, [])

    useEffect(() => {
        window.addEventListener("message", handleMessage)
        return () => window.removeEventListener("message", handleMessage)
    }, [handleMessage])

    const login = useCallback(async (credentials: AgenticaTypes.LoginRequest) => {
        setIsLoading(true)
        setError(null)
        sendMessage(AgenticaMessages.LOGIN_REQUEST, credentials)
    }, [sendMessage])

    const upgrade = useCallback(async (data: AgenticaTypes.UpgradeRequest) => {
        setIsLoading(true)
        setError(null)
        sendMessage(AgenticaMessages.UPGRADE_REQUEST, data)
    }, [sendMessage])

    const getStatus = useCallback(async () => {
        setIsLoading(true)
        sendMessage(AgenticaMessages.GET_STATUS)
    }, [sendMessage])

    const logout = useCallback(async () => {
        setStatus({ isLoggedIn: false })
        setError(null)
        sendMessage(AgenticaMessages.LOGOUT_REQUEST)
    }, [sendMessage])

    return {
        login,
        upgrade,
        logout,
        getStatus,
        status,
        isLoading,
        error
    }
}