/**
 * Server connection context
 * Manages connection state to the CLI backend
 */

import { createContext, useContext, createSignal, onMount, onCleanup, ParentComponent, Accessor } from "solid-js"
import { useVSCode } from "./vscode"
import type { ConnectionState, ServerInfo, ProfileData, DeviceAuthState, ExtensionMessage } from "../types/messages"

interface ServerContextValue {
  connectionState: Accessor<ConnectionState>
  serverInfo: Accessor<ServerInfo | undefined>
  error: Accessor<string | undefined>
  isConnected: Accessor<boolean>
  profileData: Accessor<ProfileData | null>
  deviceAuth: Accessor<DeviceAuthState>
  startLogin: () => void
}

const ServerContext = createContext<ServerContextValue>()

const initialDeviceAuth: DeviceAuthState = { status: "idle" }

export const ServerProvider: ParentComponent = (props) => {
  const vscode = useVSCode()

  const [connectionState, setConnectionState] = createSignal<ConnectionState>("connecting")
  const [serverInfo, setServerInfo] = createSignal<ServerInfo | undefined>()
  const [error, setError] = createSignal<string | undefined>()
  const [profileData, setProfileData] = createSignal<ProfileData | null>(null)
  const [deviceAuth, setDeviceAuth] = createSignal<DeviceAuthState>(initialDeviceAuth)

  onMount(() => {
    const unsubscribe = vscode.onMessage((message: ExtensionMessage) => {
      switch (message.type) {
        case "ready":
          console.log("[Kilo New] Server ready:", message.serverInfo)
          setServerInfo(message.serverInfo)
          setConnectionState("connected")
          setError(undefined)
          break

        case "connectionState":
          console.log("[Kilo New] Connection state changed:", message.state)
          setConnectionState(message.state)
          if (message.error) {
            setError(message.error)
          } else if (message.state === "connected") {
            setError(undefined)
          }
          break

        case "error":
          console.error("[Kilo New] Server error:", message.message)
          setError(message.message)
          break

        case "profileData":
          console.log("[Kilo New] Profile data:", message.data ? "received" : "null")
          setProfileData(message.data)
          break

        case "deviceAuthStarted":
          console.log("[Kilo New] Device auth started")
          setDeviceAuth({
            status: "pending",
            code: message.code,
            verificationUrl: message.verificationUrl,
            expiresIn: message.expiresIn,
          })
          break

        case "deviceAuthComplete":
          console.log("[Kilo New] Device auth complete")
          setDeviceAuth({ status: "success" })
          // Reset to idle after a short delay
          setTimeout(() => setDeviceAuth(initialDeviceAuth), 1500)
          break

        case "deviceAuthFailed":
          console.log("[Kilo New] Device auth failed:", message.error)
          setDeviceAuth({ status: "error", error: message.error })
          break

        case "deviceAuthCancelled":
          console.log("[Kilo New] Device auth cancelled")
          setDeviceAuth(initialDeviceAuth)
          break
      }
    })

    onCleanup(unsubscribe)

    // Let the extension know the webview has mounted and message handlers are registered.
    // Without this handshake, messages posted during a webview refresh can be lost.
    console.log("[Kilo New] Webview ready")
    vscode.postMessage({ type: "webviewReady" })
  })

  const startLogin = () => {
    setDeviceAuth({ status: "initiating" })
    vscode.postMessage({ type: "login" })
  }

  const value: ServerContextValue = {
    connectionState,
    serverInfo,
    error,
    isConnected: () => connectionState() === "connected",
    profileData,
    deviceAuth,
    startLogin,
  }

  return <ServerContext.Provider value={value}>{props.children}</ServerContext.Provider>
}

export function useServer(): ServerContextValue {
  const context = useContext(ServerContext)
  if (!context) {
    throw new Error("useServer must be used within a ServerProvider")
  }
  return context
}
