import React, { Children, ReactNode } from "react"

interface ImageGalleryProps {
  children: ReactNode
  columns?: string
}

export function ImageGallery({ children, columns = "3" }: ImageGalleryProps) {
  const count = Number(columns)
  const cols = Number.isFinite(count) && count > 0 ? Math.min(Math.floor(count), 4) : 3

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, ${Math.floor(960 / cols)}px), 1fr))`,
        gap: "1rem",
        alignItems: "start",
        margin: "1.5rem 0",
      }}
    >
      {Children.map(children, (child) => (
        <div
          style={{
            minWidth: 0,
          }}
        >
          {child}
        </div>
      ))}
    </div>
  )
}
