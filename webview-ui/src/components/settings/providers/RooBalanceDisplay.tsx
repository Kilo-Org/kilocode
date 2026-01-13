import { VSCodeLink } from "@vscode/webview-ui-toolkit/react"

import { useRooCreditBalance } from "@/components/ui/hooks/useRooCreditBalance"
import { useExtensionState } from "@src/context/ExtensionStateContext"

export const RooBalanceDisplay = () => {
	const { data: balance } = useRooCreditBalance()
	const { cloudApiUrl } = useExtensionState()

	if (balance === null || balance === undefined) {
		return null
	}

	const formattedBalance = balance.toFixed(2)
	const billingUrl = cloudApiUrl ? `${cloudApiUrl.replace(/\/$/, "")}/billing` : "https://app.roocode.com/billing"

	return (
		<VSCodeLink href={billingUrl} className="text-vscode-foreground hover:underline whitespace-nowrap">
			${formattedBalance}
		</VSCodeLink>
	)
}
