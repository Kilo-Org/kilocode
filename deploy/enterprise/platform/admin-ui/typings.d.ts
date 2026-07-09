import "umi/typings"

declare namespace API {
  type CurrentUser = {
    name?: string
    tenant?: string
    roles?: string[]
  }
}
