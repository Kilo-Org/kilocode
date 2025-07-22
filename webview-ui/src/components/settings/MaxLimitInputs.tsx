import React from "react"
import { MaxRequestsInput } from "./MaxRequestsInput"
import { MaxCostInput } from "./MaxCostInput"

export interface MaxLimitInputsProps {
	allowedMaxRequests?: number
	allowedMaxCost?: number
	onMaxRequestsChange: (value: number | undefined) => void
	onMaxCostChange: (value: number | undefined) => void
}

export const MaxLimitInputs: React.FC<MaxLimitInputsProps> = ({
	allowedMaxRequests,
	allowedMaxCost,
	onMaxRequestsChange,
	onMaxCostChange,
}) => {
	return (
		<div className="space-y-2">
			<div className="flex">
				<MaxRequestsInput
					allowedMaxRequests={allowedMaxRequests}
					onValueChange={onMaxRequestsChange}
					hideDescription
				/>
				<MaxCostInput allowedMaxCost={allowedMaxCost} onValueChange={onMaxCostChange} hideDescription />
			</div>
			<div className="text-xs text-vscode-descriptionForeground">
				Automatically make requests up to these limits before asking for approval to continue.
			</div>
		</div>
	)
}
