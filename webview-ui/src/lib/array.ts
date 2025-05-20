/**
 * Finds the last element in an array that satisfies the provided testing function.
 * @param array - The array to search through.
 * @param predicate - A function to test each element of the array.
 * @returns The last element in the array that passes the test, or undefined if no element passes.
 */
export function findLast<T>(array: T[], predicate: (value: T, index: number, array: T[]) => boolean): T | undefined {
  for (let i = array.length - 1; i >= 0; i--) {
    if (predicate(array[i], i, array)) {
      return array[i];
    }
  }
  return undefined;
}

/**
 * Finds the index of the last element in an array that satisfies the provided testing function.
 * @param array - The array to search through.
 * @param predicate - A function to test each element of the array.
 * @returns The index of the last element that passes the test, or -1 if no element passes.
 */
export function findLastIndex<T>(array: T[], predicate: (value: T, index: number, array: T[]) => boolean): number {
  for (let i = array.length - 1; i >= 0; i--) {
    if (predicate(array[i], i, array)) {
      return i;
    }
  }
  return -1;
}
