import { useCallback, useRef, useState } from "react"
import fuzzysort from "fuzzysort"

interface ModelWithId {
	id: string
	name: string
}

export const useFuzzyModelSearch = <T extends ModelWithId>(data: T[] | undefined) => {
	const [searchValue, setSearchValue] = useState("")

	const searchResultsRef = useRef<Map<string, number>>(new Map())
	const searchValueRef = useRef("")

	const onFilter = useCallback(
		(value: string, search: string) => {
			if (searchValueRef.current !== search) {
				searchValueRef.current = search
				searchResultsRef.current.clear()

				for (const {
					obj: { id },
					score,
				} of fuzzysort.go(search, data || [], {
					key: "name",
				})) {
					searchResultsRef.current.set(id, score)
				}
			}

			return searchResultsRef.current.get(value) ?? 0
		},
		[data],
	)

	return { searchValue, setSearchValue, onFilter }
}
