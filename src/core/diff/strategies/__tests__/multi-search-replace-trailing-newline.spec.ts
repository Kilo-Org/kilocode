import { MultiSearchReplaceDiffStrategy } from "../multi-search-replace"

describe("MultiSearchReplaceDiffStrategy - trailing newline preservation", () => {
	let strategy: MultiSearchReplaceDiffStrategy

	beforeEach(() => {
		strategy = new MultiSearchReplaceDiffStrategy()
	})

	it("should preserve trailing newlines in SEARCH content with line numbers", async () => {
		// This test verifies the fix for issue #8020
		// The regex should not consume trailing newlines, allowing stripLineNumbers to work correctly
		const originalContent = `class Example {
    constructor() {
        this.value = 0;
    }
}`
		const diffContent = `<<<<<<< SEARCH
1 | class Example {
2 |     constructor() {
3 |         this.value = 0;
4 |     }
5 | }
=======
class Example {
    constructor() {
        this.value = 1;
    }
}
>>>>>>> REPLACE`

		const result = await strategy.applyDiff(originalContent, diffContent)
		expect(result.success).toBe(true)
		if (result.success) {
			expect(result.content).toBe(`class Example {
    constructor() {
        this.value = 1;
    }
}`)
		}
	})

	it("should handle Windows line endings with trailing newlines and line numbers", async () => {
		const originalContent = "function test() {\r\n    return true;\r\n}\r\n"
		const diffContent = `<<<<<<< SEARCH
1 | function test() {
2 |     return true;
3 | }
=======
function test() {
    return false;
}
>>>>>>> REPLACE`

		const result = await strategy.applyDiff(originalContent, diffContent)
		expect(result.success).toBe(true)
		if (result.success) {
			// Should preserve Windows line endings
			expect(result.content).toBe("function test() {\r\n    return false;\r\n}\r\n")
		}
	})

	it("should handle multiple search/replace blocks with trailing newlines", async () => {
		const originalContent = `function one() {
    return 1;
}

function two() {
    return 2;
}`
		const diffContent = `<<<<<<< SEARCH
1 | function one() {
2 |     return 1;
3 | }
=======
function one() {
    return 10;
}
>>>>>>> REPLACE

<<<<<<< SEARCH
5 | function two() {
6 |     return 2;
7 | }
=======
function two() {
    return 20;
}
>>>>>>> REPLACE`

		const result = await strategy.applyDiff(originalContent, diffContent)
		expect(result.success).toBe(true)
		if (result.success) {
			expect(result.content).toBe(`function one() {
    return 10;
}

function two() {
    return 20;
}`)
		}
	})

	it("should handle content with line numbers at the last line", async () => {
		// This specifically tests the scenario from the bug report
		const originalContent = `                List<ContactInfoItemResp> addressInfoList = new ArrayList<>(CollectionUtils.size(repairInfoList) > 10 ? 10
                                : CollectionUtils.size(repairInfoList) + CollectionUtils.size(homeAddressInfoList)
                                                + CollectionUtils.size(idNoAddressInfoList) + CollectionUtils.size(workAddressInfoList)
                                                + CollectionUtils.size(personIdentityInfoList));`

		const diffContent = `<<<<<<< SEARCH
1476 |                 List<ContactInfoItemResp> addressInfoList = new ArrayList<>(CollectionUtils.size(repairInfoList) > 10 ? 10
1477 |                                 : CollectionUtils.size(repairInfoList) + CollectionUtils.size(homeAddressInfoList)
1478 |                                                 + CollectionUtils.size(idNoAddressInfoList) + CollectionUtils.size(workAddressInfoList)
1479 |                                                 + CollectionUtils.size(personIdentityInfoList));
=======
                
                // Filter addresses if optimization is enabled
                if (isAddressDisplayOptimizeEnabled()) {
                    homeAddressInfoList = filterAddressesByThreeYearRule(homeAddressInfoList);
                    personIdentityInfoList = filterAddressesByThreeYearRule(personIdentityInfoList);
                    idNoAddressInfoList = filterAddressesByThreeYearRule(idNoAddressInfoList);
                    workAddressInfoList = filterAddressesByThreeYearRule(workAddressInfoList);
                }
                
                List<ContactInfoItemResp> addressInfoList = new ArrayList<>(CollectionUtils.size(repairInfoList) > 10 ? 10
                                : CollectionUtils.size(repairInfoList) + CollectionUtils.size(homeAddressInfoList)
                                                + CollectionUtils.size(idNoAddressInfoList) + CollectionUtils.size(workAddressInfoList)
                                                + CollectionUtils.size(personIdentityInfoList));
>>>>>>> REPLACE`

		const result = await strategy.applyDiff(originalContent, diffContent)
		expect(result.success).toBe(true)
		if (result.success) {
			expect(result.content).toContain("// Filter addresses if optimization is enabled")
			expect(result.content).toContain("if (isAddressDisplayOptimizeEnabled())")
			// Verify the last line doesn't have line numbers
			expect(result.content).not.toContain("1488 |")
			expect(result.content).not.toContain("1479 |")
		}
	})

	it("should correctly strip line numbers even when last line has no trailing newline", async () => {
		const originalContent = "line 1\nline 2\nline 3" // No trailing newline
		const diffContent = `<<<<<<< SEARCH
1 | line 1
2 | line 2
3 | line 3
=======
line 1
modified line 2
line 3
>>>>>>> REPLACE`

		const result = await strategy.applyDiff(originalContent, diffContent)
		expect(result.success).toBe(true)
		if (result.success) {
			expect(result.content).toBe("line 1\nmodified line 2\nline 3")
			// Verify no line numbers remain
			expect(result.content).not.toContain(" | ")
		}
	})
})
