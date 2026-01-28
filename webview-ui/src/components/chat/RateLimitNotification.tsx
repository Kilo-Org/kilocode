import { useEffect, useState } from "react"
import { Clock } from "lucide-react"
import { Button } from "@src/components/ui"
import { useAppTranslation } from "@src/i18n/TranslationContext"
import { vscode } from "@src/utils/vscode"

interface RateLimitNotificationProps {
	resetTime: number
}

export const RateLimitNotification = ({ resetTime }: RateLimitNotificationProps) => {
	const { t } = useAppTranslation()
	const [timeRemaining, setTimeRemaining] = useState("")

	useEffect(() => {
		const updateTime = () => {
			const remaining = Math.max(0, resetTime - Date.now())
			const minutes = Math.floor(remaining / 60000)
			setTimeRemaining(t("welcome:rateLimit.waitTime", { minutes }))
		}

		updateTime()
		const interval = setInterval(updateTime, 60000) // Update every minute

		return () => clearInterval(interval)
	}, [resetTime, t])

	const handleCreateAccount = () => {
		vscode.postMessage({
			type: "rooCloudSignIn",
			useProviderSignup: true,
		})
	}

	return (
		<div className="bg-vscode-notifications-background border border-vscode-notifications-border p-4 rounded-md mb-4">
			<div className="flex items-start gap-3">
				<Clock className="size-5 text-vscode-notificationsWarningIcon-foreground shrink-0 mt-0.5" />
				<div className="flex-1">
					<p className="font-semibold text-vscode-notifications-foreground m-0">
						{t("welcome:rateLimit.heading")}
					</p>
					<p className="text-sm text-vscode-descriptionForeground mt-1 mb-2">
						{t("welcome:rateLimit.description")}
					</p>
					<p className="text-sm text-vscode-descriptionForeground mb-3">{timeRemaining}</p>
					<Button onClick={handleCreateAccount} variant="primary" size="sm">
						{t("welcome:rateLimit.createAccount")}
					</Button>
				</div>
			</div>
		</div>
	)
}
