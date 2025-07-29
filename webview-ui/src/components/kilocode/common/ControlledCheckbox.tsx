import { useEffect, useState } from "react"
import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"

export const ControlledCheckbox = ({
	checked,
	onChange,
	children,
}: {
	checked: boolean
	onChange: (checked: boolean) => void
	children: React.ReactNode
}) => {
	const [localChecked, setLocalChecked] = useState(checked)
	const [isUpdatingFromProp, setIsUpdatingFromProp] = useState(false)

	useEffect(() => {
		if (localChecked !== checked) {
			setIsUpdatingFromProp(true)
			setLocalChecked(checked)
			// Reset the flag after a short delay to ensure the render has completed
			setTimeout(() => {
				setIsUpdatingFromProp(false)
			}, 100)
		}
	}, [checked, localChecked])

	const handleChange = (e: any) => {
		if (isUpdatingFromProp) {
			return
		}
		const newValue = e.target.checked
		setLocalChecked(newValue)
		onChange(newValue)
	}

	return (
		<VSCodeCheckbox checked={localChecked} onChange={handleChange}>
			{children}
		</VSCodeCheckbox>
	)
}
