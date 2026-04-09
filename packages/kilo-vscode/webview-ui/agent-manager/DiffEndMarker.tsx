import type { Component } from "solid-js"
import { useLanguage } from "../src/context/language"

export const DiffEndMarker: Component = () => {
  const { t } = useLanguage()

  return (
    <div class="am-diff-end-marker">
      <div class="am-diff-end-mascot-wrap">
        <svg
          class="am-diff-end-mascot"
          width="96"
          height="96"
          viewBox="0 0 96 96"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          <ellipse cx="49" cy="76" rx="20" ry="6" fill="#1B1035" opacity="0.45" />

          <rect x="41" y="56" width="6" height="16" fill="#EAB308" />
          <rect x="51" y="56" width="6" height="16" fill="#EAB308" />

          <g class="am-kiloman-upper">
            <rect x="41" y="36" width="16" height="22" fill="#EAB308" />
            <circle cx="49" cy="24" r="14" fill="#FEF08A" />
            <rect x="53" y="21" width="4" height="4" fill="#111827" />
          </g>
        </svg>
      </div>
      <p class="am-diff-end-text">{t("agentManager.review.endOfLongDiff")}</p>
    </div>
  )
}
