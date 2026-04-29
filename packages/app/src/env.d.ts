interface ImportMetaEnv {
  readonly VITE_KILO_SERVER_HOST: string
  readonly VITE_KILO_SERVER_PORT: string
  readonly VITE_KILO_CHANNEL?: "dev" | "beta" | "prod"
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

export declare module "solid-js" {
  namespace JSX {
    interface Directives {
      sortable: true
    }
  }
}
