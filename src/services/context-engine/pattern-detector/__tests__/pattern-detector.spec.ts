// kilocode_change - new file
import { CodeEntity } from "../../types"
import {
	PatternDetectorService,
	RepositoryPatternDetector,
	FactoryPatternDetector,
	SingletonPatternDetector,
	ServicePatternDetector,
	resetPatternDetectorService,
	getPatternDetectorService,
} from "../index"

describe("PatternDetectorService", () => {
	let service: PatternDetectorService

	beforeEach(() => {
		resetPatternDetectorService()
		service = new PatternDetectorService()
	})

	afterEach(() => {
		resetPatternDetectorService()
	})

	const mockGetRelatedEntities = (_entityId: string, _depth?: number): CodeEntity[] => []

	describe("detector registration", () => {
		it("should register a detector", () => {
			const detector = new RepositoryPatternDetector()
			service.registerDetector(detector)
			expect(service.getRegisteredPatterns()).toContain("repository")
		})

		it("should return all registered pattern types", () => {
			service.registerDetector(new RepositoryPatternDetector())
			service.registerDetector(new FactoryPatternDetector())
			const patterns = service.getRegisteredPatterns()
			expect(patterns).toContain("repository")
			expect(patterns).toContain("factory")
		})
	})

	describe("pattern detection", () => {
		beforeEach(() => {
			service.registerDetector(new RepositoryPatternDetector())
			service.registerDetector(new FactoryPatternDetector())
			service.registerDetector(new SingletonPatternDetector())
			service.registerDetector(new ServicePatternDetector())
		})

		it("should detect repository pattern", () => {
			const entities: CodeEntity[] = [
				{
					id: "user-repo",
					name: "UserRepository",
					type: "class",
					filePath: "/src/repos/UserRepository.ts",
					startLine: 1,
					endLine: 50,
					startColumn: 0,
					endColumn: 1,
					metadata: {},
				},
				{
					id: "find-by-id",
					name: "findById",
					type: "function",
					filePath: "/src/repos/UserRepository.ts",
					startLine: 10,
					endLine: 15,
					startColumn: 0,
					endColumn: 1,
					metadata: {},
				},
				{
					id: "save",
					name: "save",
					type: "function",
					filePath: "/src/repos/UserRepository.ts",
					startLine: 20,
					endLine: 25,
					startColumn: 0,
					endColumn: 1,
					metadata: {},
				},
				{
					id: "delete",
					name: "delete",
					type: "function",
					filePath: "/src/repos/UserRepository.ts",
					startLine: 30,
					endLine: 35,
					startColumn: 0,
					endColumn: 1,
					metadata: {},
				},
			]

			const patterns = service.detectPatterns(entities, mockGetRelatedEntities)
			const repoPatterns = patterns.filter((p) => p.type === "repository")

			expect(repoPatterns.length).toBeGreaterThan(0)
			expect(repoPatterns[0].entities.some((e) => e.name === "UserRepository")).toBe(true)
		})

		it("should detect factory pattern", () => {
			const entities: CodeEntity[] = [
				{
					id: "widget-factory",
					name: "WidgetFactory",
					type: "class",
					filePath: "/src/factories/WidgetFactory.ts",
					startLine: 1,
					endLine: 30,
					startColumn: 0,
					endColumn: 1,
					metadata: {},
				},
				{
					id: "create-widget",
					name: "createWidget",
					type: "function",
					filePath: "/src/factories/WidgetFactory.ts",
					startLine: 10,
					endLine: 20,
					startColumn: 0,
					endColumn: 1,
					metadata: {},
				},
			]

			const patterns = service.detectPatterns(entities, mockGetRelatedEntities)
			const factoryPatterns = patterns.filter((p) => p.type === "factory")

			expect(factoryPatterns.length).toBeGreaterThan(0)
		})

		it("should detect singleton pattern", () => {
			const entities: CodeEntity[] = [
				{
					id: "config-singleton",
					name: "ConfigManager",
					type: "class",
					filePath: "/src/config/ConfigManager.ts",
					startLine: 1,
					endLine: 40,
					startColumn: 0,
					endColumn: 1,
					metadata: {},
				},
				{
					id: "get-instance",
					name: "getInstance",
					type: "function",
					filePath: "/src/config/ConfigManager.ts",
					startLine: 10,
					endLine: 15,
					startColumn: 0,
					endColumn: 1,
					metadata: {},
				},
				{
					id: "instance-var",
					name: "instance",
					type: "variable",
					filePath: "/src/config/ConfigManager.ts",
					startLine: 5,
					endLine: 5,
					startColumn: 0,
					endColumn: 1,
					metadata: {},
				},
			]

			const patterns = service.detectPatterns(entities, mockGetRelatedEntities)
			const singletonPatterns = patterns.filter((p) => p.type === "singleton")

			expect(singletonPatterns.length).toBeGreaterThan(0)
		})

		it("should detect service pattern", () => {
			const entities: CodeEntity[] = [
				{
					id: "user-service",
					name: "UserService",
					type: "class",
					filePath: "/src/services/UserService.ts",
					startLine: 1,
					endLine: 100,
					startColumn: 0,
					endColumn: 1,
					metadata: {},
				},
				{
					id: "get-user",
					name: "getUser",
					type: "function",
					filePath: "/src/services/UserService.ts",
					startLine: 10,
					endLine: 20,
					startColumn: 0,
					endColumn: 1,
					metadata: {},
				},
				{
					id: "update-user",
					name: "updateUser",
					type: "function",
					filePath: "/src/services/UserService.ts",
					startLine: 25,
					endLine: 40,
					startColumn: 0,
					endColumn: 1,
					metadata: {},
				},
			]

			const patterns = service.detectPatterns(entities, mockGetRelatedEntities)
			const servicePatterns = patterns.filter((p) => p.type === "service")

			expect(servicePatterns.length).toBeGreaterThan(0)
		})

		it("should filter by minimum confidence", () => {
			const highConfidenceService = new PatternDetectorService({ minConfidence: 0.9 })
			highConfidenceService.registerDetector(new ServicePatternDetector())

			const entities: CodeEntity[] = [
				{
					id: "helper",
					name: "Helper",
					type: "class",
					filePath: "/src/Helper.ts",
					startLine: 1,
					endLine: 10,
					startColumn: 0,
					endColumn: 1,
					metadata: {},
				},
			]

			const patterns = highConfidenceService.detectPatterns(entities, mockGetRelatedEntities)
			expect(patterns.length).toBe(0)
		})

		it("should detect specific pattern types", () => {
			const entities: CodeEntity[] = [
				{
					id: "user-repo",
					name: "UserRepository",
					type: "class",
					filePath: "/src/repos/UserRepository.ts",
					startLine: 1,
					endLine: 50,
					startColumn: 0,
					endColumn: 1,
					metadata: {},
				},
				{
					id: "user-service",
					name: "UserService",
					type: "class",
					filePath: "/src/services/UserService.ts",
					startLine: 1,
					endLine: 100,
					startColumn: 0,
					endColumn: 1,
					metadata: {},
				},
			]

			const patterns = service.detectPatternTypes(["repository"], entities, mockGetRelatedEntities)

			expect(patterns.every((p) => p.type === "repository")).toBe(true)
		})

		it("should sort patterns by confidence score", () => {
			const entities: CodeEntity[] = [
				{
					id: "user-repo",
					name: "UserRepository",
					type: "class",
					filePath: "/src/repos/UserRepository.ts",
					startLine: 1,
					endLine: 50,
					startColumn: 0,
					endColumn: 1,
					metadata: {},
				},
				{
					id: "find-all",
					name: "findAll",
					type: "function",
					filePath: "/src/repos/UserRepository.ts",
					startLine: 10,
					endLine: 15,
					startColumn: 0,
					endColumn: 1,
					metadata: {},
				},
				{
					id: "find-by-id",
					name: "findById",
					type: "function",
					filePath: "/src/repos/UserRepository.ts",
					startLine: 20,
					endLine: 25,
					startColumn: 0,
					endColumn: 1,
					metadata: {},
				},
				{
					id: "save",
					name: "save",
					type: "function",
					filePath: "/src/repos/UserRepository.ts",
					startLine: 30,
					endLine: 35,
					startColumn: 0,
					endColumn: 1,
					metadata: {},
				},
				{
					id: "delete",
					name: "delete",
					type: "function",
					filePath: "/src/repos/UserRepository.ts",
					startLine: 40,
					endLine: 45,
					startColumn: 0,
					endColumn: 1,
					metadata: {},
				},
				{
					id: "helper",
					name: "HelperService",
					type: "class",
					filePath: "/src/Helper.ts",
					startLine: 1,
					endLine: 10,
					startColumn: 0,
					endColumn: 1,
					metadata: {},
				},
			]

			const patterns = service.detectPatterns(entities, mockGetRelatedEntities)

			for (let i = 1; i < patterns.length; i++) {
				expect(patterns[i - 1].confidenceScore).toBeGreaterThanOrEqual(patterns[i].confidenceScore)
			}
		})
	})

	describe("singleton instance", () => {
		it("should return singleton instance", () => {
			const instance1 = getPatternDetectorService()
			const instance2 = getPatternDetectorService()
			expect(instance1).toBe(instance2)
		})

		it("should have default detectors registered", () => {
			const instance = getPatternDetectorService()
			const patterns = instance.getRegisteredPatterns()
			expect(patterns).toContain("repository")
			expect(patterns).toContain("factory")
			expect(patterns).toContain("singleton")
			expect(patterns).toContain("service")
		})
	})
})

describe("RepositoryPatternDetector", () => {
	const detector = new RepositoryPatternDetector()
	const mockGetRelatedEntities = (_entityId: string, _depth?: number): CodeEntity[] => []

	it("should have correct pattern type", () => {
		expect(detector.patternType).toBe("repository")
	})

	it("should detect repository by name", () => {
		const entities: CodeEntity[] = [
			{
				id: "repo",
				name: "DataRepository",
				type: "class",
				filePath: "/src/DataRepository.ts",
				startLine: 1,
				endLine: 10,
				startColumn: 0,
				endColumn: 1,
				metadata: {},
			},
		]

		const patterns = detector.detect(entities, mockGetRelatedEntities)
		expect(patterns.length).toBeGreaterThan(0)
	})

	it("should detect DAO pattern", () => {
		const entities: CodeEntity[] = [
			{
				id: "dao",
				name: "UserDAO",
				type: "class",
				filePath: "/src/UserDAO.ts",
				startLine: 1,
				endLine: 10,
				startColumn: 0,
				endColumn: 1,
				metadata: {},
			},
		]

		const patterns = detector.detect(entities, mockGetRelatedEntities)
		expect(patterns.length).toBeGreaterThan(0)
	})

	it("should not detect non-repository classes", () => {
		const entities: CodeEntity[] = [
			{
				id: "controller",
				name: "UserController",
				type: "class",
				filePath: "/src/UserController.ts",
				startLine: 1,
				endLine: 10,
				startColumn: 0,
				endColumn: 1,
				metadata: {},
			},
		]

		const patterns = detector.detect(entities, mockGetRelatedEntities)
		expect(patterns.length).toBe(0)
	})
})

describe("FactoryPatternDetector", () => {
	const detector = new FactoryPatternDetector()
	const mockGetRelatedEntities = (_entityId: string, _depth?: number): CodeEntity[] => []

	it("should have correct pattern type", () => {
		expect(detector.patternType).toBe("factory")
	})

	it("should detect factory class", () => {
		const entities: CodeEntity[] = [
			{
				id: "factory",
				name: "ComponentFactory",
				type: "class",
				filePath: "/src/ComponentFactory.ts",
				startLine: 1,
				endLine: 30,
				startColumn: 0,
				endColumn: 1,
				metadata: {},
			},
			{
				id: "create",
				name: "create",
				type: "function",
				filePath: "/src/ComponentFactory.ts",
				startLine: 10,
				endLine: 20,
				startColumn: 0,
				endColumn: 1,
				metadata: {},
			},
		]

		const patterns = detector.detect(entities, mockGetRelatedEntities)
		expect(patterns.length).toBeGreaterThan(0)
	})

	it("should detect standalone factory function", () => {
		const entities: CodeEntity[] = [
			{
				id: "create-fn",
				name: "createComponent",
				type: "function",
				filePath: "/src/factory.ts",
				startLine: 1,
				endLine: 10,
				startColumn: 0,
				endColumn: 1,
				metadata: {},
			},
		]

		const patterns = detector.detect(entities, mockGetRelatedEntities)
		expect(patterns.length).toBeGreaterThan(0)
	})
})

describe("SingletonPatternDetector", () => {
	const detector = new SingletonPatternDetector()
	const mockGetRelatedEntities = (_entityId: string, _depth?: number): CodeEntity[] => []

	it("should have correct pattern type", () => {
		expect(detector.patternType).toBe("singleton")
	})

	it("should detect singleton with getInstance", () => {
		const entities: CodeEntity[] = [
			{
				id: "singleton",
				name: "Logger",
				type: "class",
				filePath: "/src/Logger.ts",
				startLine: 1,
				endLine: 30,
				startColumn: 0,
				endColumn: 1,
				metadata: {},
			},
			{
				id: "get-instance",
				name: "getInstance",
				type: "function",
				filePath: "/src/Logger.ts",
				startLine: 10,
				endLine: 15,
				startColumn: 0,
				endColumn: 1,
				metadata: {},
			},
		]

		const patterns = detector.detect(entities, mockGetRelatedEntities)
		expect(patterns.length).toBeGreaterThan(0)
	})

	it("should detect singleton with instance variable", () => {
		const entities: CodeEntity[] = [
			{
				id: "singleton",
				name: "Config",
				type: "class",
				filePath: "/src/Config.ts",
				startLine: 1,
				endLine: 30,
				startColumn: 0,
				endColumn: 1,
				metadata: {},
			},
			{
				id: "instance",
				name: "sharedInstance",
				type: "variable",
				filePath: "/src/Config.ts",
				startLine: 5,
				endLine: 5,
				startColumn: 0,
				endColumn: 1,
				metadata: {},
			},
			{
				id: "get-instance",
				name: "getInstance",
				type: "function",
				filePath: "/src/Config.ts",
				startLine: 10,
				endLine: 15,
				startColumn: 0,
				endColumn: 1,
				metadata: {},
			},
		]

		const patterns = detector.detect(entities, mockGetRelatedEntities)
		expect(patterns.length).toBeGreaterThan(0)
		expect(patterns[0].confidenceScore).toBeGreaterThan(0.5)
	})
})

describe("ServicePatternDetector", () => {
	const detector = new ServicePatternDetector()
	const mockGetRelatedEntities = (_entityId: string, _depth?: number): CodeEntity[] => []

	it("should have correct pattern type", () => {
		expect(detector.patternType).toBe("service")
	})

	it("should detect service class", () => {
		const entities: CodeEntity[] = [
			{
				id: "service",
				name: "AuthService",
				type: "class",
				filePath: "/src/AuthService.ts",
				startLine: 1,
				endLine: 50,
				startColumn: 0,
				endColumn: 1,
				metadata: {},
			},
			{
				id: "login",
				name: "login",
				type: "function",
				filePath: "/src/AuthService.ts",
				startLine: 10,
				endLine: 20,
				startColumn: 0,
				endColumn: 1,
				metadata: {},
			},
			{
				id: "logout",
				name: "logout",
				type: "function",
				filePath: "/src/AuthService.ts",
				startLine: 25,
				endLine: 35,
				startColumn: 0,
				endColumn: 1,
				metadata: {},
			},
		]

		const patterns = detector.detect(entities, mockGetRelatedEntities)
		expect(patterns.length).toBeGreaterThan(0)
	})

	it("should detect manager class", () => {
		const entities: CodeEntity[] = [
			{
				id: "manager",
				name: "SessionManager",
				type: "class",
				filePath: "/src/SessionManager.ts",
				startLine: 1,
				endLine: 50,
				startColumn: 0,
				endColumn: 1,
				metadata: {},
			},
		]

		const patterns = detector.detect(entities, mockGetRelatedEntities)
		expect(patterns.length).toBeGreaterThan(0)
	})

	it("should detect provider class", () => {
		const entities: CodeEntity[] = [
			{
				id: "provider",
				name: "DataProvider",
				type: "class",
				filePath: "/src/DataProvider.ts",
				startLine: 1,
				endLine: 50,
				startColumn: 0,
				endColumn: 1,
				metadata: {},
			},
		]

		const patterns = detector.detect(entities, mockGetRelatedEntities)
		expect(patterns.length).toBeGreaterThan(0)
	})
})
