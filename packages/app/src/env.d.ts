import "solid-js"

interface ImportMetaEnv {
  readonly VITE_KILO_SERVER_HOST: string
  readonly VITE_KILO_SERVER_PORT: string
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
