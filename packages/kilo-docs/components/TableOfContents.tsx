import React, { useState, useEffect } from "react"
import Link from "next/link"

const TAB_SYNC_EVENT = "kilo-tab-select"

function slugify(label: string) {
  return label
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
}

export function TableOfContents({ toc }) {
  const [tab, setTab] = useState("")
  const [activeHash, setActiveHash] = useState("")
  const items = toc.filter((item) => {
    if (!item.id || (item.level !== 2 && item.level !== 3)) return false

    return !item.tab || item.tab.slug === tab
  })

  useEffect(() => {
    const update = () => {
      const hash = window.location.hash.slice(1)
      const item = toc.find((entry) => entry.id === hash && entry.tab)
      setActiveHash(window.location.hash)
      setTab(item?.tab?.slug ?? (toc.some((entry) => entry.tab?.slug === hash) ? hash : ""))
    }

    const sync = (e: Event) => {
      const label = (e as CustomEvent<string>).detail
      setActiveHash(window.location.hash)
      setTab(slugify(label))
    }

    update()
    window.addEventListener("hashchange", update)
    window.addEventListener(TAB_SYNC_EVENT, sync)
    return () => {
      window.removeEventListener("hashchange", update)
      window.removeEventListener(TAB_SYNC_EVENT, sync)
    }
  }, [toc])

  if (items.length <= 1) {
    return null
  }

  return (
    <nav className="toc">
      <ul className="flex column">
        {items.map((item) => {
          const href = `#${item.id}`
          const active = activeHash === href
          const select = (e: React.MouseEvent<HTMLAnchorElement>) => {
            if (!item.tab) return

            e.preventDefault()
            window.dispatchEvent(new CustomEvent(TAB_SYNC_EVENT, { detail: item.tab.label }))
            setActiveHash(href)
            setTab(item.tab.slug)
            history.pushState(null, "", href)
            requestAnimationFrame(() => document.getElementById(item.id)?.scrollIntoView())
          }

          return (
            <li
              key={`${item.tab?.slug ?? "page"}-${item.id}`}
              className={[active ? "active" : undefined, item.level === 3 ? "padded" : undefined]
                .filter(Boolean)
                .join(" ")}
            >
              <Link href={href} onClick={select}>
                {item.title}
              </Link>
            </li>
          )
        })}
      </ul>
      <style jsx>
        {`
          nav {
            position: sticky;
            top: 0;
            max-height: calc(100vh - var(--top-nav-height) - 6rem);
            width: 100%;
            align-self: flex-start;
            margin-bottom: 1rem;
            padding: 0.5rem 0 0;
            border-left: 1px solid var(--border-color);
            transition: border-color 0.2s ease;
            overflow-y: auto;
          }
          ul {
            margin: 0;
            padding-left: 1rem;
            display: flex;
            flex-direction: column;
          }
          li {
            list-style-type: none;
            margin: 0 0 1rem;
          }
          li :global(a) {
            text-decoration: none;
            color: var(--text-secondary);
          }
          li :global(a:hover),
          li.active :global(a) {
            text-decoration: underline;
          }
          li.padded {
            padding-left: 1rem;
          }

          /* Hide on tablet and mobile */
          @media (max-width: 1024px) {
            nav {
              display: none;
            }
          }
        `}
      </style>
    </nav>
  )
}
