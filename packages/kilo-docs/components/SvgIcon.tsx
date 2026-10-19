interface SvgIconProps {
  src: string
  size?: string
  label?: string
}

/**
 * Renders a monochrome SVG from the public folder as a CSS mask filled with
 * `currentColor`, so the glyph inherits the surrounding text color and adapts to
 * light/dark — unlike the `<img>`-based {% icon %} tag. Use for small line icons
 * (e.g., Lucide). Renders on the server, so there is no fetch or flash on load.
 */
export function SvgIcon({ src, size = "1em", label }: SvgIconProps) {
  const mask = `url(${JSON.stringify(src)}) center / contain no-repeat`
  return (
    <span
      role={label ? "img" : undefined}
      aria-label={label || undefined}
      aria-hidden={label ? undefined : true}
      style={{
        display: "inline-block",
        width: size,
        height: size,
        verticalAlign: "middle",
        backgroundColor: "currentColor",
        mask,
        WebkitMask: mask,
      }}
    />
  )
}
