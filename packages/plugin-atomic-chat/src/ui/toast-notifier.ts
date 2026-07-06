import { LOG_PREFIX } from "../constants"

export class ToastNotifier {
  constructor(private readonly client: any) {}

  async success(message: string, title?: string, duration?: number): Promise<void> {
    try {
      if (!this.client?.tui?.showToast) {
        console.warn(`${LOG_PREFIX} Toast API not available (client.tui.showToast missing)`)
        return
      }
      await this.client.tui.showToast({
        body: {
          title,
          message,
          variant: "success",
          duration: duration || 3000,
        },
      })
    } catch (error) {
      console.error(`${LOG_PREFIX} Failed to show success toast`, error)
    }
  }

  async error(message: string, title?: string, duration?: number): Promise<void> {
    try {
      if (!this.client?.tui?.showToast) {
        console.warn(`${LOG_PREFIX} Toast API not available (client.tui.showToast missing)`)
        return
      }
      await this.client.tui.showToast({
        body: {
          title,
          message,
          variant: "error",
          duration: duration || 5000,
        },
      })
    } catch (error) {
      console.error(`${LOG_PREFIX} Failed to show error toast`, error)
    }
  }

  async warning(message: string, title?: string, duration?: number): Promise<void> {
    try {
      if (!this.client?.tui?.showToast) {
        console.warn(`${LOG_PREFIX} Toast API not available (client.tui.showToast missing)`)
        return
      }
      await this.client.tui.showToast({
        body: {
          title,
          message,
          variant: "warning",
          duration: duration || 4000,
        },
      })
    } catch (error) {
      console.error(`${LOG_PREFIX} Failed to show warning toast`, error)
    }
  }

  async progress(message: string, title?: string, progress?: number): Promise<void> {
    try {
      if (!this.client?.tui?.showToast) {
        console.warn(`${LOG_PREFIX} Toast API not available (client.tui.showToast missing)`)
        return
      }
      await this.client.tui.showToast({
        body: {
          title,
          message: progress !== undefined ? `${message} (${progress}%)` : message,
          variant: "info",
          duration: progress !== undefined ? 0 : 2000,
        },
      })
    } catch (error) {
      console.error(`${LOG_PREFIX} Failed to show progress toast`, error)
    }
  }
}
