export type AdapterOptions<Throw extends boolean = boolean> = { throwOnError?: Throw; signal?: AbortSignal }
export type AdapterResult<T, Throw extends boolean = boolean> = Throw extends true
  ? { data: T; error?: never }
  : { data: T; error?: never } | { data?: never; error: unknown }

/** Preserve both the result envelope and throwOnError's success-only contract. */
export function result<T, Throw extends boolean = false>(
  work: () => Promise<T>,
  options?: AdapterOptions<Throw>,
): Promise<AdapterResult<T, Throw>> {
  return work().then(
    (data) => ({ data }),
    (error: unknown) => {
      if (options?.throwOnError) throw error
      return { error }
    },
  ) as Promise<AdapterResult<T, Throw>>
}
