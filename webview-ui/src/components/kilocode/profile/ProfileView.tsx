// import { useExtensionState } from "@/context/ExtensionStateContext" // No longer needed
import React, { useEffect } from "react"
import { vscode } from "@/utils/vscode"
import { ProfileDataResponsePayload, WebviewMessage } from "@roo/shared/WebviewMessage"

interface ProfileViewProps {
	onDone: () => void
}

const ProfileView: React.FC<ProfileViewProps> = ({ onDone }) => {
	// const [fetchError, setFetchError] = React.useState<string | null>(null) // Error display not currently implemented
	const [balance, setBalance] = React.useState<number | null>(null)

	useEffect(() => {
		// Request profile data from the extension
		// The backend will handle checking for the token
		vscode.postMessage({
			type: "fetchProfileDataRequest",
		})
	}, []) // Empty dependency array, so it runs once on mount

	useEffect(() => {
		// Listen for profile data response from the extension
		const handleMessage = (event: MessageEvent<WebviewMessage>) => {
			const message = event.data
			if (message.type === "profileDataResponse") {
				const payload = message.payload as ProfileDataResponsePayload
				if (payload.success) {
					setBalance(payload.data?.balance) // Assuming 'balance' is in data
					// setFetchError(null)
				} else {
					// setFetchError(payload.error || "Failed to fetch profile data.") // Error display not currently implemented
					console.error("Error fetching profile data:", payload.error)
					setBalance(null)
				}
			}
		}

		window.addEventListener("message", handleMessage)
		return () => {
			window.removeEventListener("message", handleMessage)
		}
	}, [])

	return (
		<div className="p-4">
			<h1 className="text-lg font-semibold mb-4">User Profile</h1>
			{/* Placeholder for profile data */}
			{balance && <h1>${balance.toFixed(2)}</h1>}
			<button onClick={onDone} className="mt-4 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600">
				Close
			</button>
		</div>
	)
}

export default ProfileView
