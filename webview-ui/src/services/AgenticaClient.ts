import { AgenticaTypes } from "../../../src/core/types/AgenticaTypes"
import { AgenticaMessages } from "../../../src/core/webview/messages/AgenticaMessages"

export class AgenticaClient {
    private static instance: AgenticaClient
    
    private constructor() {}
    
    static getInstance(): AgenticaClient {
        if (!AgenticaClient.instance) {
            AgenticaClient.instance = new AgenticaClient()
        }
        return AgenticaClient.instance
    }
    
    async login(email: string, password: string): Promise<AgenticaTypes.LoginResponse> {
        return new Promise((resolve, reject) => {
            const messageHandler = (event: MessageEvent) => {
                const message = event.data
                if (message.type === AgenticaMessages.LOGIN_RESPONSE) {
                    window.removeEventListener("message", messageHandler)
                    if (message.error) {
                        reject(new Error(message.error))
                    } else {
                        resolve(message.data)
                    }
                }
            }
            
            window.addEventListener("message", messageHandler)
            window.vscode?.postMessage({
                type: AgenticaMessages.LOGIN_REQUEST,
                data: { email, password }
            })
        })
    }
    
    async upgrade(plan: string): Promise<AgenticaTypes.UpgradeResponse> {
        return new Promise((resolve, reject) => {
            const messageHandler = (event: MessageEvent) => {
                const message = event.data
                if (message.type === AgenticaMessages.UPGRADE_RESPONSE) {
                    window.removeEventListener("message", messageHandler)
                    if (message.error) {
                        reject(new Error(message.error))
                    } else {
                        resolve(message.data)
                    }
                }
            }
            
            window.addEventListener("message", messageHandler)
            window.vscode?.postMessage({
                type: AgenticaMessages.UPGRADE_REQUEST,
                data: { plan }
            })
        })
    }
    
    async getStatus(): Promise<AgenticaTypes.StatusResponse> {
        return new Promise((resolve, reject) => {
            const messageHandler = (event: MessageEvent) => {
                const message = event.data
                if (message.type === AgenticaMessages.STATUS_RESPONSE) {
                    window.removeEventListener("message", messageHandler)
                    if (message.error) {
                        reject(new Error(message.error))
                    } else {
                        resolve(message.data)
                    }
                }
            }
            
            window.addEventListener("message", messageHandler)
            window.vscode?.postMessage({
                type: AgenticaMessages.GET_STATUS
            })
        })
    }
    
    async logout(): Promise<void> {
        return new Promise((resolve) => {
            const messageHandler = (event: MessageEvent) => {
                const message = event.data
                if (message.type === AgenticaMessages.LOGOUT_RESPONSE) {
                    window.removeEventListener("message", messageHandler)
                    resolve()
                }
            }
            
            window.addEventListener("message", messageHandler)
            window.vscode?.postMessage({
                type: AgenticaMessages.LOGOUT_REQUEST
            })
            
            // Timeout after 5 seconds
            setTimeout(() => {
                window.removeEventListener("message", messageHandler)
                resolve()
            }, 5000)
        })
    }
}