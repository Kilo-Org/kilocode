import type { GenericTelemetry } from "./types"

export function createGenericTelemetry(): GenericTelemetry {
  return {
    coordinatorWakes: 0,
    eventsConsumed: 0,
    resumes: 0,
    stallsDetected: 0,
  }
}

export function recordCoordinatorWake(telemetry: GenericTelemetry, consumed: number): void {
  telemetry.coordinatorWakes += 1
  telemetry.eventsConsumed += consumed
}

export function recordResume(telemetry: GenericTelemetry): void {
  telemetry.resumes += 1
}

export function recordStall(telemetry: GenericTelemetry): void {
  telemetry.stallsDetected += 1
}
