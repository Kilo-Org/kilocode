export class CloudError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "CloudError"
  }
}

export class ServiceTransportError extends CloudError {
  constructor() {
    super("Unable to reach configured service")
    this.name = "ServiceTransportError"
  }
}

export class ServiceRedirectError extends CloudError {
  constructor() {
    super("Service redirects are not allowed")
    this.name = "ServiceRedirectError"
  }
}

export function ambiguousAdmissionError(procedure: "start" | "send") {
  return new CloudError(`Cloud Agent ${procedure} outcome is unknown; do not retry automatically`)
}
