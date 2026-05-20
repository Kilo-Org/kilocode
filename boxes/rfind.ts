export function rfind<T>(
  arr: readonly T[],
  test: (item: T, i: number, arr: readonly T[]) => boolean,
): T | undefined {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (test(arr[i], i, arr)) return arr[i]
  }
}
