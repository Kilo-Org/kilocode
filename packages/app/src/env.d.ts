import "solid-js"

interface ImportMetaEnv {
  readonly VITE_DEVIL_SERVER_HOST: string
  readonly VITE_DEVIL_SERVER_PORT: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module "solid-js" {
  namespace JSX {
    interface Directives {
      sortable: true
    }
  }
}
