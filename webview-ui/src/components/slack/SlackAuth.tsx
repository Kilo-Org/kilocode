// kilocode_change - Slack Authentication Component

import React, { useState } from "react"
import { Button } from "../ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "../ui/dialog"
import { Input } from "../ui/input"
import { Badge } from "../ui/badge"
import { Loader2, CheckCircle2, XCircle, ExternalLink } from "lucide-react"

interface SlackAuthProps {
	onAuthenticate?: (botToken: string, userToken: string) => Promise<{ success: boolean; error?: string }>
	isAuthenticated?: boolean
	workspaceName?: string
}

export const SlackAuth: React.FC<SlackAuthProps> = ({
	onAuthenticate,
	isAuthenticated = false,
	workspaceName = "",
}) => {
	const [open, setOpen] = useState(false)
	const [botToken, setBotToken] = useState("")
	const [userToken, setUserToken] = useState("")
	const [isAuthenticating, setIsAuthenticating] = useState(false)
	const [authResult, setAuthResult] = useState<{ success: boolean; error?: string } | null>(null)

	const handleAuthenticate = async () => {
		if (!onAuthenticate || !botToken || !userToken) return

		setIsAuthenticating(true)
		setAuthResult(null)

		try {
			const result = await onAuthenticate(botToken, userToken)
			setAuthResult(result)

			if (result.success) {
				setTimeout(() => {
					setOpen(false)
					setBotToken("")
					setUserToken("")
					setAuthResult(null)
				}, 2000)
			}
		} catch (error) {
			setAuthResult({ success: false, error: error.message })
		} finally {
			setIsAuthenticating(false)
		}
	}

	const handleOpenSlackApp = () => {
		window.open("https://api.slack.com/apps", "_blank")
	}

	const handleOpenSlackDocs = () => {
		window.open("https://api.slack.com/authentication", "_blank")
	}

	if (isAuthenticated) {
		return (
			<div className="flex items-center gap-2">
				<Badge
					variant="secondary"
					className="bg-green-100 text-green-700 dark:bg-green-900/20 dark:text-green-400">
					<CheckCircle2 className="h-3 w-3 mr-1" />
					Connected to {workspaceName}
				</Badge>
				<Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
					Configure
				</Button>
			</div>
		)
	}

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>
				<Button variant="outline" size="sm">
					<ExternalLink className="h-4 w-4 mr-2" />
					Connect Slack
				</Button>
			</DialogTrigger>
			<DialogContent className="sm:max-w-[500px]">
				<DialogHeader>
					<DialogTitle>Connect Slack Workspace</DialogTitle>
				</DialogHeader>

				<div className="space-y-4">
					<div className="text-sm text-muted-foreground">
						Connect your Slack workspace to share code discussions and AI assistance with your team.
					</div>

					<div className="space-y-2">
						<div className="text-sm font-medium">Step 1: Create a Slack App</div>
						<div className="text-sm text-muted-foreground">
							Create a Slack app with bot and user tokens to enable sharing functionality.
						</div>
						<Button variant="outline" size="sm" onClick={handleOpenSlackApp}>
							<ExternalLink className="h-4 w-4 mr-2" />
							Open Slack Apps
						</Button>
					</div>

					<div className="space-y-2">
						<div className="text-sm font-medium">Step 2: Enter Tokens</div>
						<div className="space-y-3">
							<div className="space-y-1">
								<div className="text-sm font-medium">Bot Token</div>
								<Input
									type="password"
									placeholder="xoxb-your-bot-token"
									value={botToken}
									onChange={(e) => setBotToken(e.target.value)}
								/>
								<div className="text-xs text-muted-foreground">
									Starts with <code>xoxb-</code>
								</div>
							</div>

							<div className="space-y-1">
								<div className="text-sm font-medium">User Token</div>
								<Input
									type="password"
									placeholder="xoxp-your-user-token"
									value={userToken}
									onChange={(e) => setUserToken(e.target.value)}
								/>
								<div className="text-xs text-muted-foreground">
									Starts with <code>xoxp-</code>
								</div>
							</div>
						</div>
					</div>

					<div className="space-y-2">
						<div className="text-sm font-medium">Need Help?</div>
						<Button variant="ghost" size="sm" onClick={handleOpenSlackDocs}>
							<ExternalLink className="h-4 w-4 mr-2" />
							Slack Authentication Docs
						</Button>
					</div>

					<div className="flex justify-end gap-2">
						<Button variant="outline" onClick={() => setOpen(false)}>
							Cancel
						</Button>
						<Button onClick={handleAuthenticate} disabled={!botToken || !userToken || isAuthenticating}>
							{isAuthenticating ? (
								<>
									<Loader2 className="h-4 w-4 mr-2 animate-spin" />
									Connecting...
								</>
							) : (
								"Connect"
							)}
						</Button>
					</div>

					{authResult && (
						<div
							className={`flex items-center gap-2 p-3 rounded-md ${
								authResult.success
									? "bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400"
									: "bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400"
							}`}>
							{authResult.success ? (
								<CheckCircle2 className="h-5 w-5" />
							) : (
								<XCircle className="h-5 w-5" />
							)}
							<span className="text-sm">
								{authResult.success
									? "Slack workspace connected successfully!"
									: authResult.error || "Failed to connect Slack workspace"}
							</span>
						</div>
					)}
				</div>
			</DialogContent>
		</Dialog>
	)
}
