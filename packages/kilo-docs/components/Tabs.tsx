import React, { useState, useEffect, Children, isValidElement, ReactNode, ReactElement } from "react"

interface TabProps {
  label: string
  children: ReactNode
}

interface TabsProps {
  children: ReactNode
}

function slugify(label: string) {
  return label
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
}

export function Tab({ children }: TabProps) {
  return <>{children}</>
}

export function Tabs({ children }: TabsProps) {
  const tabs = Children.toArray(children).filter(
    (child): child is ReactElement<TabProps> =>
      isValidElement(child) && (child.type === Tab || (child.props as any)?.label !== undefined),
  )

  const indexFromHash = () => {
    if (typeof window === "undefined") return 0
    const hash = window.location.hash.slice(1)
    if (!hash) return 0
    const found = tabs.findIndex((tab) => slugify(tab.props.label) === hash)
    return found >= 0 ? found : 0
  }

  const [activeIndex, setActiveIndex] = useState(indexFromHash)

  useEffect(() => {
    const onHashChange = () => setActiveIndex(indexFromHash())
    window.addEventListener("hashchange", onHashChange)
    return () => window.removeEventListener("hashchange", onHashChange)
  }, [])

  const selectTab = (index: number) => {
    setActiveIndex(index)
    const slug = slugify(tabs[index].props.label)
    history.replaceState(null, "", `#${slug}`)
  }

  return (
    <div className="tabs-container my-6 border border-neutral-300 dark:border-neutral-700 rounded-lg overflow-hidden">
      <div className="tabs-header flex border-b border-neutral-300 dark:border-neutral-700 bg-neutral-100 dark:bg-neutral-800/50 overflow-x-auto scrollbar-none touch-pan-x">
        {tabs.map((tab, index) => (
          <button
            key={index}
            className={`px-2 py-2 text-xs sm:px-4 sm:py-2.5 sm:text-sm font-medium transition-colors whitespace-nowrap ${
              activeIndex === index
                ? "bg-white dark:bg-neutral-900 text-yellow-800 dark:text-yellow-300 border-b-2 border-yellow-800 dark:border-yellow-300 -mb-[1px]"
                : "text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-200 hover:bg-neutral-200 dark:hover:bg-neutral-700/50"
            }`}
            onClick={() => selectTab(index)}
          >
            {tab.props.label}
          </button>
        ))}
      </div>
      <div className="tabs-content p-3 sm:p-4 bg-white dark:bg-neutral-900/50">{tabs[activeIndex]}</div>
    </div>
  )
}
