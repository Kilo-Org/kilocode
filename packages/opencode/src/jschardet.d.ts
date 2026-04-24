declare module "jschardet" {
  export interface Result {
    encoding?: string
    confidence?: number
  }

  export function detect(input: ArrayLike<number>): Result

  const api: {
    detect(input: ArrayLike<number>): Result
  }

  export default api
}
