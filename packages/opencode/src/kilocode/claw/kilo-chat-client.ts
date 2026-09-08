import { KiloChatClient as SharedKiloChatClient } from "@kilocode/kilo-gateway/claw"

export { KiloChatApiError } from "@kilocode/kilo-gateway/claw"
export type { KiloChatClientConfig } from "@kilocode/kilo-gateway/claw"

export class KiloChatClient extends SharedKiloChatClient {}
