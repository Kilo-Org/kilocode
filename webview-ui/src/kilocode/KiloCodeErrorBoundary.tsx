import * as React from "react"
import { telemetryClient } from "../utils/TelemetryClient"
import { stringifyError } from "@roo/kilocode/errorUtils"

type Props = {
	children: React.ReactNode
}

type State = {
	error?: string
}

export class KiloCodeErrorBoundary extends React.Component<Props, State> {
	constructor(props: Props) {
		super(props)
		this.state = {}
	}

	static getDerivedStateFromError(error: unknown) {
		return {
			error: stringifyError(error),
		}
	}

	componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
		telemetryClient.captureException(error, { context: "react_error_boundary", errorInfo })
	}

	render() {
		if (!this.state.error) {
			return this.props.children
		}
		return (
			<div>
				<h2 className="text-lg font-bold mt-0 mb-2">Something went wrong</h2>
				<p className="mb-4">
					We&apos;re sorry for the inconvenience. Please help us improve by reporting this error. You can
					reach out to us on{" "}
					<a href="https://github.com/Kilo-Org/kilocode/issues" target="_blank" rel="noreferrer">
						GitHub
					</a>{" "}
					or{" "}
					<a href="https://discord.kilocode.ai" target="_blank" rel="noreferrer">
						Discord
					</a>
					.
				</p>
				<p className="mb-2">Please copy and paste the following error message:</p>
				<pre className="p-2 border rounded text-sm overflow-auto">{this.state.error}</pre>
			</div>
		)
	}
}
