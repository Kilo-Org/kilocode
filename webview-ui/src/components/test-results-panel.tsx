// kilocode_change - new file

import React, { useState, useEffect } from "react"
import { Button } from "./ui/button"
import { Badge } from "./ui/badge"
import { Progress } from "./ui/progress"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs"
import { ToggleSwitch } from "./ui/toggle-switch"
import {
	CheckCircle2,
	XCircle,
	AlertTriangle,
	Play,
	RefreshCw,
	Settings,
	Eye,
	EyeOff,
	Activity,
	Shield,
} from "lucide-react"

interface QAResult {
	id: string
	filePath: string
	operation: string
	status: "pending" | "running" | "completed" | "failed"
	duration: number
	result?: {
		issues?: Array<{ severity: string; message: string; line: number }>
		coverage?: { lines: number; functions: number; branches: number }
		testCount?: number
		securityIssues?: Array<{ severity: string; type: string; description: string }>
	}
	timestamp: Date
	confidence: number
}

interface QAState {
	isRunning: boolean
	currentTests: QAResult[]
	completedTests: QAResult[]
	failedTests: QAResult[]
	privacyMode: boolean
	localAIProvider: string | null
	coverage: {
		total: number
		covered: number
		percentage: number
	}
}

export function TestResultsPanel() {
	const [qaState, setQaState] = useState<QAState>({
		isRunning: false,
		currentTests: [],
		completedTests: [],
		failedTests: [],
		privacyMode: false,
		localAIProvider: null,
		coverage: { total: 0, covered: 0, percentage: 0 },
	})

	const [selectedTest, setSelectedTest] = useState<QAResult | null>(null)
	const [activeTab, setActiveTab] = useState("overview")

	// Simulate real-time updates
	useEffect(() => {
		const interval = setInterval(() => {
			// This would be replaced with actual WebSocket or API calls
			if (qaState.isRunning) {
				// Simulate test progress
			}
		}, 1000)

		return () => clearInterval(interval)
	}, [qaState.isRunning])

	const getStatusIcon = (status: QAResult["status"]) => {
		switch (status) {
			case "completed":
				return <CheckCircle2 className="w-4 h-4 text-green-500" />
			case "failed":
				return <XCircle className="w-4 h-4 text-red-500" />
			case "running":
				return <RefreshCw className="w-4 h-4 text-blue-500 animate-spin" />
			default:
				return <AlertTriangle className="w-4 h-4 text-yellow-500" />
		}
	}

	const getSeverityColor = (severity: string) => {
		switch (severity.toLowerCase()) {
			case "critical":
			case "error":
				return "bg-red-500"
			case "high":
			case "warning":
				return "bg-orange-500"
			case "medium":
				return "bg-yellow-500"
			case "low":
			case "info":
				return "bg-blue-500"
			default:
				return "bg-gray-500"
		}
	}

	const formatDuration = (ms: number) => {
		if (ms < 1000) return `${ms}ms`
		return `${(ms / 1000).toFixed(2)}s`
	}

	const runTests = async () => {
		setQaState((prev) => ({ ...prev, isRunning: true }))
		// This would trigger actual test execution
		setTimeout(() => {
			setQaState((prev) => ({ ...prev, isRunning: false }))
		}, 5000)
	}

	const togglePrivacyMode = (enabled: boolean) => {
		setQaState((prev) => ({ ...prev, privacyMode: enabled }))
		// This would send the setting to the backend
	}

	return (
		<div className="h-full flex flex-col p-4 space-y-4">
			{/* Header */}
			<div className="flex items-center justify-between">
				<div className="flex items-center space-x-2">
					<Activity className="w-5 h-5" />
					<h2 className="text-lg font-semibold">Quality Assurance</h2>
					{qaState.isRunning && (
						<Badge variant="secondary" className="animate-pulse">
							Testing...
						</Badge>
					)}
				</div>
				<div className="flex items-center space-x-2">
					<Button onClick={runTests} disabled={qaState.isRunning} variant="outline" size="sm">
						<Play className="w-4 h-4 mr-1" />
						Run Tests
					</Button>
					<Button variant="outline" size="sm">
						<RefreshCw className="w-4 h-4" />
					</Button>
					<Button variant="outline" size="sm">
						<Settings className="w-4 h-4" />
					</Button>
				</div>
			</div>

			{/* Privacy Mode Toggle */}
			<div className="border rounded-lg p-4">
				<div className="flex items-center justify-between mb-2">
					<div className="flex items-center">
						{qaState.privacyMode ? <EyeOff className="w-4 h-4 mr-2" /> : <Eye className="w-4 h-4 mr-2" />}
						<span className="text-sm font-medium">Privacy Mode</span>
					</div>
					<ToggleSwitch
						checked={qaState.privacyMode}
						onChange={() => togglePrivacyMode(!qaState.privacyMode)}
					/>
				</div>
				<div className="text-sm text-muted-foreground">Force all AI operations to stay local</div>
				{qaState.privacyMode && (
					<div className="mt-2 p-2 bg-yellow-50 border border-yellow-200 rounded text-xs text-yellow-800">
						<div className="flex items-center">
							<AlertTriangle className="w-4 h-4 mr-1" />
							Privacy mode is active. All AI operations will use local models only.
						</div>
					</div>
				)}
			</div>

			{/* Main Content */}
			<Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1">
				<TabsList className="grid w-full grid-cols-4">
					<TabsTrigger value="overview">Overview</TabsTrigger>
					<TabsTrigger value="tests">Tests</TabsTrigger>
					<TabsTrigger value="coverage">Coverage</TabsTrigger>
					<TabsTrigger value="security">Security</TabsTrigger>
				</TabsList>

				<TabsContent value="overview" className="flex-1 space-y-4 mt-4">
					<div className="grid grid-cols-2 gap-4">
						<div className="border rounded-lg p-4">
							<h3 className="text-sm font-medium mb-3">Test Pipeline</h3>
							<div className="space-y-2">
								<div className="flex items-center justify-between text-sm">
									<span>Linting...</span>
									<CheckCircle2 className="w-4 h-4 text-green-500" />
								</div>
								<div className="flex items-center justify-between text-sm">
									<span>Testing...</span>
									{qaState.isRunning ? (
										<RefreshCw className="w-4 h-4 text-blue-500 animate-spin" />
									) : (
										<CheckCircle2 className="w-4 h-4 text-green-500" />
									)}
								</div>
								<div className="flex items-center justify-between text-sm">
									<span>Security Check...</span>
									<AlertTriangle className="w-4 h-4 text-yellow-500" />
								</div>
							</div>
						</div>

						<div className="border rounded-lg p-4">
							<h3 className="text-sm font-medium mb-3">Coverage Summary</h3>
							<div className="space-y-2">
								<div className="flex justify-between text-sm">
									<span>Overall Coverage</span>
									<span>{qaState.coverage.percentage.toFixed(1)}%</span>
								</div>
								<Progress value={qaState.coverage.percentage} className="h-2" />
								<div className="text-xs text-muted-foreground">
									{qaState.coverage.covered} of {qaState.coverage.total} lines covered
								</div>
							</div>
						</div>
					</div>

					<div className="border rounded-lg p-4">
						<h3 className="text-sm font-medium mb-3">Recent Test Results</h3>
						<div className="space-y-2 max-h-48 overflow-y-auto">
							{qaState.completedTests.slice(-5).map((test) => (
								<div
									key={test.id}
									className="flex items-center justify-between p-2 rounded border cursor-pointer hover:bg-muted/50"
									onClick={() => setSelectedTest(test)}>
									<div className="flex items-center space-x-2">
										{getStatusIcon(test.status)}
										<span className="text-sm font-medium">{test.operation}</span>
										<span className="text-xs text-muted-foreground">
											{test.filePath.split("/").pop()}
										</span>
									</div>
									<div className="text-xs text-muted-foreground">{formatDuration(test.duration)}</div>
								</div>
							))}
						</div>
					</div>
				</TabsContent>

				<TabsContent value="tests" className="flex-1 mt-4">
					<div className="border rounded-lg p-4 h-full">
						<h3 className="text-sm font-medium mb-3">Test Results</h3>
						<div className="space-y-2 max-h-96 overflow-y-auto">
							{[...qaState.completedTests, ...qaState.failedTests].map((test) => (
								<div
									key={test.id}
									className="p-3 rounded border cursor-pointer"
									onClick={() => setSelectedTest(test)}>
									<div className="flex items-center justify-between mb-2">
										<div className="flex items-center space-x-2">
											{getStatusIcon(test.status)}
											<span className="font-medium">{test.operation}</span>
											<Badge variant="outline">{test.filePath}</Badge>
										</div>
										<div className="text-xs text-muted-foreground">
											{formatDuration(test.duration)}
										</div>
									</div>
									{test.result && (
										<div className="text-sm">
											{test.result.testCount && (
												<div>Tests generated: {test.result.testCount}</div>
											)}
											{test.result.issues && <div>Issues found: {test.result.issues.length}</div>}
										</div>
									)}
								</div>
							))}
						</div>
					</div>
				</TabsContent>

				<TabsContent value="coverage" className="flex-1 mt-4">
					<div className="border rounded-lg p-4">
						<h3 className="text-sm font-medium mb-3">Coverage Analysis</h3>
						<div className="space-y-4">
							<div className="grid grid-cols-3 gap-4">
								<div className="text-center">
									<div className="text-2xl font-bold text-green-600">
										{qaState.coverage.percentage.toFixed(1)}%
									</div>
									<div className="text-sm text-muted-foreground">Lines</div>
								</div>
								<div className="text-center">
									<div className="text-2xl font-bold text-blue-600">{qaState.coverage.covered}</div>
									<div className="text-sm text-muted-foreground">Covered</div>
								</div>
								<div className="text-center">
									<div className="text-2xl font-bold text-orange-600">
										{qaState.coverage.total - qaState.coverage.covered}
									</div>
									<div className="text-sm text-muted-foreground">Uncovered</div>
								</div>
							</div>
							<Progress value={qaState.coverage.percentage} className="h-4" />
						</div>
					</div>
				</TabsContent>

				<TabsContent value="security" className="flex-1 mt-4">
					<div className="border rounded-lg p-4 h-full">
						<h3 className="text-sm font-medium mb-3 flex items-center">
							<Shield className="w-4 h-4 mr-2" />
							Security Audit
						</h3>
						<div className="space-y-2 max-h-96 overflow-y-auto">
							{qaState.completedTests
								.filter((test) => test.result?.securityIssues)
								.map((test) => (
									<div key={test.id} className="p-3 rounded border">
										<div className="flex items-center justify-between mb-2">
											<span className="font-medium">{test.filePath}</span>
											<Badge variant="destructive">
												{test.result?.securityIssues?.length} issues
											</Badge>
										</div>
										<div className="space-y-1">
											{test.result?.securityIssues?.map((issue, index) => (
												<div key={index} className="flex items-start space-x-2 text-sm">
													<div
														className={`w-2 h-2 rounded-full mt-1 ${getSeverityColor(issue.severity)}`}
													/>
													<div>
														<div className="font-medium">{issue.type}</div>
														<div className="text-muted-foreground">{issue.description}</div>
													</div>
												</div>
											))}
										</div>
									</div>
								))}
						</div>
					</div>
				</TabsContent>
			</Tabs>

			{/* Selected Test Detail */}
			{selectedTest && (
				<div className="border rounded-lg p-4 mt-4">
					<h3 className="text-sm font-medium mb-3">Test Details</h3>
					<div className="space-y-2 text-sm">
						<div>
							<strong>File:</strong> {selectedTest.filePath}
						</div>
						<div>
							<strong>Operation:</strong> {selectedTest.operation}
						</div>
						<div>
							<strong>Status:</strong> {selectedTest.status}
						</div>
						<div>
							<strong>Duration:</strong> {formatDuration(selectedTest.duration)}
						</div>
						<div>
							<strong>Confidence:</strong> {(selectedTest.confidence * 100).toFixed(1)}%
						</div>
						{selectedTest.result && (
							<div className="mt-2">
								<strong>Results:</strong>
								<pre className="mt-1 p-2 bg-muted rounded text-xs overflow-auto">
									{JSON.stringify(selectedTest.result, null, 2)}
								</pre>
							</div>
						)}
					</div>
				</div>
			)}
		</div>
	)
}
