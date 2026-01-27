export interface DeviceAuthInitiateResponse {
  code: string
  verificationUrl: string
  expiresIn: number
}

export interface Organization {
  id: string
  name: string
  role?: string
}

export interface DeviceAuthPollResponse {
  status: "pending" | "approved" | "denied" | "expired"
  token?: string
  userEmail?: string
  organizations?: Organization[]
}

export interface PollOptions<T> {
  interval: number
  maxAttempts: number
  pollFn: () => Promise<PollResult<T>>
}

export interface PollResult<T> {
  continue: boolean
  data?: T
  error?: Error
}
