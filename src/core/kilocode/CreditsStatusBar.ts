import * as vscode from "vscode"
import { ClineProvider } from "../webview/ClineProvider"
import { BalanceDataResponsePayload } from "../../shared/WebviewMessage"
import { t } from "../../i18n"

export class CreditsStatusBar implements vscode.Disposable {
	private statusBarItem: vscode.StatusBarItem
	private refreshInterval?: NodeJS.Timeout
	private balanceHandlerDisposable?: vscode.Disposable
	private lastSuccessfulBalance?: number
	private lastSuccessfulTimestamp?: Date
	private previousBalance?: number
	private previousBalanceTimestamp?: Date
	private isRefreshing = false
	private lastConsumptionRate?: string
	private readonly REFRESH_INTERVAL_MS = 5 * 60 * 1000 // 5 minutes

	constructor(
		private context: vscode.ExtensionContext,
		private provider: ClineProvider,
	) {
		this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100)
	}

	async initialize(): Promise<void> {
		// Register the refresh command
		const refreshCommand = vscode.commands.registerCommand("kilo-code.refreshCredits", async () => {
			await this.refresh()
		})
		this.context.subscriptions.push(refreshCommand)

		// Set up click handler
		this.statusBarItem.command = "kilo-code.refreshCredits"

		// Register balance handler with provider
		this.balanceHandlerDisposable = this.provider.registerBalanceHandler((payload) => {
			this.updateStatusBar(payload)
		})

		// Start periodic refresh
		this.startPeriodicRefresh()

		// Initial refresh
		await this.refresh()
	}

	private startPeriodicRefresh(): void {
		this.refreshInterval = setInterval(async () => {
			await this.refresh()
		}, this.REFRESH_INTERVAL_MS)
	}

	private stopPeriodicRefresh(): void {
		if (this.refreshInterval) {
			clearInterval(this.refreshInterval)
			this.refreshInterval = undefined
		}
	}

	private clearBalanceState(): void {
		this.lastSuccessfulBalance = undefined
		this.lastSuccessfulTimestamp = undefined
		this.previousBalance = undefined
		this.previousBalanceTimestamp = undefined
		this.lastConsumptionRate = undefined
	}

	public async clearAndRefresh(): Promise<void> {
		this.clearBalanceState()
		await this.refresh()
	}

	async refresh(): Promise<void> {
		if (this.isRefreshing) {
			return // Prevent concurrent refreshes
		}

		this.isRefreshing = true
		this.updateStatusBar({ success: false, isLoading: true })

		try {
			const result = await this.provider.fetchBalanceData()

			// Don't call updateStatusBar here - the registered balance handler will be notified
			// and call updateStatusBar automatically when fetchBalanceData completes
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)
			this.updateStatusBar({ success: false, error: errorMessage })
		} finally {
			this.isRefreshing = false
		}
	}

	private async updateStatusBar(payload: BalanceDataResponsePayload): Promise<void> {
		// Get the current state to check for token
		const { apiConfiguration } = await this.provider.getState()
		const hasToken = apiConfiguration?.kilocodeToken

		if (!hasToken) {
			this.statusBarItem.hide()
			return
		}

		// Handle loading state
		if (payload.isLoading) {
			this.statusBarItem.text = `$(sync~spin) Kilo Code: ${t("kilocode:creditsstatusbar:loading")}`
			this.statusBarItem.tooltip = t("kilocode:creditsstatusbar:clickToRefresh")
			this.statusBarItem.backgroundColor = undefined
			this.statusBarItem.show()
			return
		}

		if (payload.success && payload.data?.balance !== undefined) {
			this.lastSuccessfulBalance = payload.data.balance
			this.lastSuccessfulTimestamp = new Date()

			const currentBalance = this.lastSuccessfulBalance

			// Calculate consumption rate using PREVIOUS values BEFORE updating stored values
			let consumptionRate = ""
			let ratePerMin = 0
			if (this.previousBalanceTimestamp && this.previousBalance) {
				const timeDiffMs = Date.now() - this.previousBalanceTimestamp.getTime()
				const balanceDiff = this.previousBalance - currentBalance

				// Debug logging
				console.debug(`[CreditsStatusBar] Balance diff: ${balanceDiff}, Time diff: ${timeDiffMs} ms`)

				ratePerMin = balanceDiff / (timeDiffMs / 1000 / 60)

				if (ratePerMin > 0) {
					consumptionRate = `@ $${this.formatBalance(ratePerMin)}/${t("kilocode:creditsstatusbar:minute")}`
					console.debug(`[CreditsStatusBar] Showing consumption rate: ${consumptionRate}`)
				}
			}

			// Store current values as previous for next calculation
			this.previousBalance = currentBalance
			this.previousBalanceTimestamp = this.lastSuccessfulTimestamp

			this.statusBarItem.text = `$(credit-card) Kilo Code: $${this.formatBalance(currentBalance)} ${consumptionRate}`

			this.statusBarItem.backgroundColor = undefined
		}
		this.statusBarItem.show()
	}

	private formatBalance(balance: number, compact: boolean = true): string {
		// Clamp negative balances to 0 for display
		const clampedBalance = Math.max(0, balance)

		if (compact) {
			// Use compact notation for status bar (1.21k, 1.29M)
			return new Intl.NumberFormat(undefined, {
				maximumFractionDigits: 2,
				notation: "compact",
			}).format(clampedBalance)
		} else {
			// Use full notation for tooltip
			return new Intl.NumberFormat(undefined, {
				minimumFractionDigits: 2,
				maximumFractionDigits: 5,
			}).format(clampedBalance)
		}
	}

	dispose(): void {
		this.stopPeriodicRefresh()
		this.balanceHandlerDisposable?.dispose()
		this.statusBarItem.dispose()
	}
}
