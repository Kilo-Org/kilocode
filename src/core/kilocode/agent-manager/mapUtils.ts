/**
 * Move a value from one key to another in a Map.
 * If the old key exists, deletes it and sets the new key.
 * @returns true if the key was renamed, false if old key didn't exist
 */
export function renameMapKey<K, V>(map: Map<K, V>, oldKey: K, newKey: K): boolean {
	const value = map.get(oldKey)
	if (value === undefined) {
		return false
	}
	map.delete(oldKey)
	map.set(newKey, value)
	return true
}
