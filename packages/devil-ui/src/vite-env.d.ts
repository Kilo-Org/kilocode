/// <reference types="vite/client" />

// Declare module shapes for asset imports used by devil-ui components.
// These are resolved by Vite's plugin pipeline at build time; TypeScript
// only needs to know they export a string (the URL / data URI).

declare module "*.svg" {
  const content: string
  export default content
}

declare module "*.png" {
  const content: string
  export default content
}

declare module "*.woff2" {
  const content: string
  export default content
}

declare module "*.css" {
  // CSS modules return a class-map; plain CSS side-effect imports are void.
  const styles: Record<string, string>
  export default styles
}
