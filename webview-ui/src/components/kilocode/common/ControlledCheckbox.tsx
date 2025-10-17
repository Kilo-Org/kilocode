import { useEffect, useState, FormEvent } from "react"
import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import { flushSync } from "react-dom"

/**
 * ControlledCheckbox is a custom checkbox component that manages its own state
 * while also allowing external control via the `checked` prop.
 * It ensures that changes to the `checked` prop are reflected in the local state
 * without causing unnecessary re-renders or conflicts.
 */
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
			flushSync(() => {
				setIsUpdatingFromProp(false)
			})
		}
	}, [checked, localChecked])

	const handleChange = (e: Event | FormEvent<HTMLElement>) => {
		if (isUpdatingFromProp) {
			return
		}
		const target = e.target as HTMLInputElement
		const newValue = target.checked
		setLocalChecked(newValue)
		onChange(newValue)
	}

	return (
		<VSCodeCheckbox checked={localChecked} onChange={handleChange}>
			{children}
		</VSCodeCheckbox>
	)
}
