import { useState, useCallback } from "react"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"

import { useExtensionState } from "../../context/ExtensionStateContext"
import { vscode } from "../../utils/vscode"
import ApiOptions from "../settings/ApiOptions"
import { Tab, TabContent } from "../common/Tab"
import { Alert } from "../common/Alert"
import { validateApiConfiguration } from "../../utils/validate"

const WelcomeView = () => {
	const { apiConfiguration, setApiConfiguration, uriScheme } = useExtensionState()

	const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined)

	const handleSubmit = useCallback(() => {
		const error = validateApiConfiguration(apiConfiguration)
		if (error) {
			setErrorMessage(error)
			return
		}
		vscode.postMessage({ type: "apiConfiguration", apiConfiguration })
	}, [apiConfiguration, setErrorMessage])

	return (
		<Tab>
			<TabContent className="flex flex-col gap-5">
				<h2 className="m-0 p-0">Hi, welcome to Kilo Code!</h2>
				<Alert className="font-bold text-sm">To get started, this extension needs an API provider.</Alert>
				<ApiOptions
					fromWelcomeView
					apiConfiguration={apiConfiguration || {}}
					uriScheme={uriScheme}
					setApiConfigurationField={(field, value) => setApiConfiguration({ [field]: value })}
					errorMessage={errorMessage}
					setErrorMessage={setErrorMessage}
				/>
			</TabContent>
			<div className="sticky bottom-0 bg-vscode-sideBar-background p-5">
				<div className="flex flex-col gap-1">
					<VSCodeButton onClick={handleSubmit}>Let's go!</VSCodeButton>
					{errorMessage && <div className="text-vscode-errorForeground">{errorMessage}</div>}
				</div>
			</div>
		</Tab>
	)
}

export default WelcomeView
