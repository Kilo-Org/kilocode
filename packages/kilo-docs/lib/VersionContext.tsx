import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react"
import { useRouter } from "next/router"
import type { Platform } from "./types"

type DocsVersion = "classic" | "next"

interface VersionContextValue {
  version: DocsVersion
  setVersion: (v: DocsVersion) => void
}

const VersionContext = createContext<VersionContextValue>({
  version: "classic",
  setVersion: () => {},
})

const STORAGE_KEY = "docs-version"
const QUERY_PARAM = "v"

function readInitialVersion(query: Record<string, string | string[] | undefined>): DocsVersion {
  const param = query[QUERY_PARAM]
  const paramValue = Array.isArray(param) ? param[0] : param
  if (paramValue === "classic" || paramValue === "next") return paramValue

  if (typeof window !== "undefined") {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === "classic" || stored === "next") return stored
  }

  return "classic"
}

export function VersionProvider({ children }: { children: ReactNode }) {
  const router = useRouter()
  const [version, setVersionState] = useState<DocsVersion>("classic")
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    setVersionState(readInitialVersion(router.query))
    setHydrated(true)
  }, [])

  // Sync when query param changes (e.g. shared link with ?v=next)
  useEffect(() => {
    if (!hydrated) return
    const param = router.query[QUERY_PARAM]
    const paramValue = Array.isArray(param) ? param[0] : param
    if (paramValue === "classic" || paramValue === "next") {
      setVersionState(paramValue)
      localStorage.setItem(STORAGE_KEY, paramValue)
    }
  }, [router.query, hydrated])

  const setVersion = useCallback(
    (v: DocsVersion) => {
      setVersionState(v)
      localStorage.setItem(STORAGE_KEY, v)
      // Remove query param if present so it doesn't override on next navigation
      if (router.query[QUERY_PARAM]) {
        const { [QUERY_PARAM]: _, ...rest } = router.query
        router.replace({ pathname: router.pathname, query: rest }, undefined, { shallow: true })
      }
    },
    [router],
  )

  return <VersionContext.Provider value={{ version, setVersion }}>{children}</VersionContext.Provider>
}

export function useVersion() {
  return useContext(VersionContext)
}

/** Returns true if the given platform value should be visible for the current version */
export function isVisibleForVersion(platform: Platform | undefined, version: DocsVersion): boolean {
  if (!platform || platform === "all") return true
  return platform === version
}
