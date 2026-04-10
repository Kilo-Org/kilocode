import React, { useEffect, useState } from "react"

type Theme = "light" | "dark" | "system"

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("system")
  const [mounted, setMounted] = useState(false)

  // On mount, read the preference from localStorage or default to 'system'
  useEffect(() => {
    setMounted(true)
    const storedTheme = localStorage.getItem("theme") as Theme | null
    if (storedTheme) {
      setTheme(storedTheme)
    }
  }, [])

  // Apply the theme to the document
  useEffect(() => {
    if (!mounted) return

    const root = document.documentElement

    if (theme === "system") {
      localStorage.removeItem("theme")
      const systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches
      root.classList.toggle("dark", systemDark)
    } else {
      localStorage.setItem("theme", theme)
      root.classList.toggle("dark", theme === "dark")
    }
  }, [theme, mounted])

  // Listen for system preference changes
  useEffect(() => {
    if (!mounted) return

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)")

    const handleChange = (e: MediaQueryListEvent) => {
      if (theme === "system") {
        document.documentElement.classList.toggle("dark", e.matches)
      }
    }

    mediaQuery.addEventListener("change", handleChange)
    return () => mediaQuery.removeEventListener("change", handleChange)
  }, [theme, mounted])

  const cycleTheme = () => {
    const themes: Theme[] = ["system", "light", "dark"]
    const currentIndex = themes.indexOf(theme)
    const nextIndex = (currentIndex + 1) % themes.length
    setTheme(themes[nextIndex])
  }

  // Avoid hydration mismatch by not rendering until mounted
  if (!mounted) {
    return (
      <button className="theme-toggle" aria-label="Toggle theme" style={{ width: "32px", height: "32px" }}>
        <span style={{ opacity: 0 }}><MoonIcon /></span>
      </button>
    )
  }

  const getIcon = () => {
    if (theme === "system") {
      return <SystemIcon />
    }
    if (theme === "dark") {
      return <MoonIcon />
    }
    return <SunIcon />
  }

  const getLabel = () => {
    if (theme === "system") {
      return "Using system theme"
    }
    if (theme === "dark") {
      return "Dark mode"
    }
    return "Light mode"
  }

  return (
    <>
      <button onClick={cycleTheme} className="theme-toggle" aria-label={getLabel()} title={getLabel()}>
        {getIcon()}
      </button>
      <style jsx>{`
        .theme-toggle {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 32px;
          height: 32px;
          padding: 0;
          border: 1px solid var(--border-color);
          border-radius: 6px;
          background: var(--bg-secondary);
          color: var(--text-color);
          cursor: pointer;
          transition:
            background-color 0.2s ease,
            border-color 0.2s ease,
            color 0.2s ease;
        }
        .theme-toggle:hover {
          background: var(--border-color);
        }
      `}</style>
    </>
  )
}

function SunIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="8" cy="8" r="3.5" />
      <path d="M8 2.5V1" />
      <path d="M8 15v-1.5" />
      <path d="M11.889 4.111l.707-.707" />
      <path d="M3.404 12.596l.707-.707" />
      <path d="M13.5 8h1.5" />
      <path d="M1 8h1.5" />
      <path d="M11.889 11.889l.707.707" />
      <path d="M3.404 3.404l.707.707" />
    </svg>
  )
}

function MoonIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M14 8.526A6 6 0 1 1 7.473 2 4.666 4.666 0 0 0 14 8.526z" />
    </svg>
  )
}

function SystemIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="2" y="3" width="12" height="8" rx="1" />
      <path d="M5 13h6" />
      <path d="M8 11v2" />
    </svg>
  )
}
