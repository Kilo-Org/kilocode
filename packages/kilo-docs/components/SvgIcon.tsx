import { useEffect, useState } from "react"

interface SvgIconProps {
  src: string
  size?: string
  label?: string
}

/**
 * Inlines an SVG from the public folder so its `stroke="currentColor"` inherits
 * the surrounding text color and adapts to light/dark — unlike the `<img>`-based
 * {% icon %} tag. Use for small monochrome glyphs (e.g., Lucide line icons).
 */
export function SvgIcon({ src, size = "1em", label }: SvgIconProps) {
  const [markup, setMarkup] = useState("")

  useEffect(() => {
    let active = true
    fetch(src)
      .then((res) => (res.ok ? res.text() : ""))
      .then((text) => {
        if (!active) return
        // Drop the fixed dimensions from the root <svg> only (not inner shapes
        // like <rect>) so the glyph scales to the span while keeping its viewBox
        // and `currentColor` stroke.
        setMarkup(text.replace(/<svg\b[^>]*>/, (tag) => tag.replace(/\s(?:width|height)="[^"]*"/g, "")))
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [src])

  return (
    <>
      <span
        className="svg-icon"
        role={label ? "img" : undefined}
        aria-label={label || undefined}
        aria-hidden={label ? undefined : true}
        style={{ display: "inline-flex", width: size, height: size, verticalAlign: "middle" }}
        dangerouslySetInnerHTML={{ __html: markup }}
      />
      <style jsx global>{`
        .svg-icon svg {
          width: 100%;
          height: 100%;
          display: block;
        }
      `}</style>
    </>
  )
}
