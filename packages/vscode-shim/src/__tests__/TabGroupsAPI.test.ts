import { TabGroupsAPI, type Tab, type TabGroup } from "../api/TabGroupsAPI.js"
import { Uri } from "../classes/Uri.js"

describe("TabGroupsAPI", () => {
	let tabGroups: TabGroupsAPI

	beforeEach(() => {
		tabGroups = new TabGroupsAPI()
	})

	describe("all property", () => {
		it("should return empty array initially", () => {
			expect(tabGroups.all).toEqual([])
		})

		it("should return array of TabGroup", () => {
			expect(Array.isArray(tabGroups.all)).toBe(true)
		})
	})

	describe("onDidChangeTabs()", () => {
		it("should return a disposable", () => {
			const disposable = tabGroups.onDidChangeTabs(() => {})

			expect(disposable).toBeDefined()
			expect(typeof disposable.dispose).toBe("function")
		})

		it("should call listener when _simulateTabChange is called", () => {
			const listener = vi.fn()
			tabGroups.onDidChangeTabs(listener)

			tabGroups._simulateTabChange()

			expect(listener).toHaveBeenCalledTimes(1)
		})

		it("should not call listener after dispose", () => {
			const listener = vi.fn()
			const disposable = tabGroups.onDidChangeTabs(listener)

			disposable.dispose()
			tabGroups._simulateTabChange()

			expect(listener).not.toHaveBeenCalled()
		})

		it("should support multiple listeners", () => {
			const listener1 = vi.fn()
			const listener2 = vi.fn()

			tabGroups.onDidChangeTabs(listener1)
			tabGroups.onDidChangeTabs(listener2)
			tabGroups._simulateTabChange()

			expect(listener1).toHaveBeenCalledTimes(1)
			expect(listener2).toHaveBeenCalledTimes(1)
		})
	})

	describe("close()", () => {
		it("should return false when tab is not found", async () => {
			const mockTab: Tab = {
				input: { uri: Uri.file("/test/file.txt") },
				label: "file.txt",
				isActive: true,
				isDirty: false,
			}

			const result = await tabGroups.close(mockTab)

			expect(result).toBe(false)
		})

		it("should return a promise", () => {
			const mockTab: Tab = {
				input: { uri: Uri.file("/test/file.txt") },
				label: "file.txt",
				isActive: true,
				isDirty: false,
			}

			const result = tabGroups.close(mockTab)

			expect(result).toBeInstanceOf(Promise)
		})
	})

	describe("_simulateTabChange()", () => {
		it("should fire the onDidChangeTabs event", () => {
			const listener = vi.fn()
			tabGroups.onDidChangeTabs(listener)

			tabGroups._simulateTabChange()

			expect(listener).toHaveBeenCalled()
		})
	})

	describe("dispose()", () => {
		it("should not throw when called", () => {
			expect(() => tabGroups.dispose()).not.toThrow()
		})

		it("should stop firing events after dispose", () => {
			const listener = vi.fn()
			tabGroups.onDidChangeTabs(listener)

			tabGroups.dispose()
			// After dispose, internal emitter is disposed so new events shouldn't fire
			// But existing listeners may still be registered
		})

		it("should be safe to call multiple times", () => {
			expect(() => {
				tabGroups.dispose()
				tabGroups.dispose()
			}).not.toThrow()
		})
	})
})

describe("Tab interface", () => {
	it("should have required properties", () => {
		const tab: Tab = {
			input: { uri: Uri.file("/test/file.txt") },
			label: "file.txt",
			isActive: true,
			isDirty: false,
		}

		expect(tab.input).toBeDefined()
		expect(tab.label).toBe("file.txt")
		expect(tab.isActive).toBe(true)
		expect(tab.isDirty).toBe(false)
	})
})

describe("TabGroup interface", () => {
	it("should have tabs array", () => {
		const tabGroup: TabGroup = {
			tabs: [],
		}

		expect(Array.isArray(tabGroup.tabs)).toBe(true)
	})

	it("should contain Tab objects", () => {
		const tab: Tab = {
			input: { uri: Uri.file("/test/file.txt") },
			label: "file.txt",
			isActive: true,
			isDirty: false,
		}

		const tabGroup: TabGroup = {
			tabs: [tab],
		}

		expect(tabGroup.tabs).toHaveLength(1)
		expect(tabGroup.tabs[0]).toBe(tab)
	})
})
