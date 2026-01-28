import React, { useState, Children, isValidElement, ReactNode, ReactElement } from "react"

interface TabProps {
	label: string
	children: ReactNode
}

interface TabsProps {
	children: ReactNode
}

export function Tab({ children }: TabProps) {
	return <>{children}</>
}

export function Tabs({ children }: TabsProps) {
	const [activeIndex, setActiveIndex] = useState(0)

	const tabs = Children.toArray(children).filter(
		(child): child is ReactElement<TabProps> =>
			isValidElement(child) && (child.type === Tab || (child.props as any)?.label !== undefined),
	)

	return (
		<div className="tabs-container my-6 border border-neutral-300 dark:border-neutral-700 rounded-lg overflow-hidden">
			<div className="tabs-header flex border-b border-neutral-300 dark:border-neutral-700 bg-neutral-100 dark:bg-neutral-800/50 overflow-x-auto">
				{tabs.map((tab, index) => (
					<button
						key={index}
						className={`px-2 py-2 text-xs sm:px-4 sm:py-2.5 sm:text-sm font-medium transition-colors whitespace-nowrap ${
							activeIndex === index
								? "bg-white dark:bg-neutral-900 text-yellow-800 dark:text-yellow-300 border-b-2 border-yellow-800 dark:border-yellow-300 -mb-[1px]"
								: "text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-200 hover:bg-neutral-200 dark:hover:bg-neutral-700/50"
						}`}
						onClick={() => setActiveIndex(index)}>
						{tab.props.label}
					</button>
				))}
			</div>
			<div className="tabs-content p-3 sm:p-4 bg-white dark:bg-neutral-900/50">{tabs[activeIndex]}</div>
		</div>
	)
}
