import React, { Children, ReactElement, ReactNode, cloneElement, isValidElement } from "react"

interface ImageGalleryProps {
  children: ReactNode
  columns?: string
  width?: string
}

interface GalleryImageProps {
  compact?: boolean
}

function addPxIfNeeded(value: string) {
  if (/^\d+(\.\d+)?$/.test(value)) return `${value}px`
  return value
}

export function ImageGallery({ children, columns = "3", width = "220px" }: ImageGalleryProps) {
  const count = Number(columns)
  const cols = Number.isFinite(count) && count > 0 ? Math.min(Math.floor(count), 4) : 3
  const size = addPxIfNeeded(width)

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, ${size}), ${size}))`,
        gap: "1rem",
        alignItems: "start",
        justifyContent: "center",
        margin: "1.5rem 0",
        maxWidth: `calc(${cols} * ${size} + ${cols - 1}rem)`,
      }}
    >
      {Children.map(children, (child) => {
        const item = isValidElement<GalleryImageProps>(child)
          ? cloneElement(child as ReactElement<GalleryImageProps>, { compact: true })
          : child

        return (
          <div
            style={{
              minWidth: 0,
            }}
          >
            {item}
          </div>
        )
      })}
    </div>
  )
}
