import type {
  OpenCodeClient,
  Pty,
  PtyCreateInput,
  PtyGetInput,
  PtyRemoveInput,
  PtyUpdateInput,
} from "@opencode-ai/client/promise"
import { result, type AdapterOptions } from "./result"

type Scope = { directory?: string }
type Size = { cols: number; rows: number }

/** Native PTY Info is the wire shape; existing host callers read id/title and render the rest. */
export type PtyInfo = Pty

export interface PtyCreateRequest extends Scope {
  cwd?: string
  title?: string
  env?: Record<string, string>
  /** v1 callers size the terminal at create; the native create takes no viewport, so the
   *  initial size lands through pty.update before the attach info is returned. */
  size?: Size
}

export interface PtyUpdateRequest extends Scope {
  ptyID: string
  title?: string
  size?: Size
}

export interface PtyRemoveRequest extends Scope {
  ptyID: string
}

/** Single-use ticket bound to the issuing scope directory; the connect URL must carry it. */
export interface PtyConnectToken {
  ticket: string
  expires_in: number
  directory: string
}

export function createPtyMethods(client: OpenCodeClient, defaultDirectory: string) {
  const location = (input: Scope) => ({ directory: input.directory ?? defaultDirectory })
  return {
    create: <Throw extends boolean = false>(input: PtyCreateRequest, options?: AdapterOptions<Throw>) =>
      result(async () => {
        const created = await client.pty.create(
          { location: location(input), cwd: input.cwd, title: input.title, env: input.env },
          options,
        )
        if (!input.size) return created.data
        return (await client.pty.update({ ptyID: created.data.id, location: location(input), size: input.size }, options))
          .data
      }, options),
    update: <Throw extends boolean = false>(input: PtyUpdateRequest, options?: AdapterOptions<Throw>) =>
      result(
        async () =>
          (
            await client.pty.update(
              { ptyID: input.ptyID, location: location(input), title: input.title, size: input.size },
              options,
            )
          ).data,
        options,
      ),
    remove: <Throw extends boolean = false>(input: PtyRemoveRequest, options?: AdapterOptions<Throw>) =>
      result(async () => {
        await client.pty.remove({ ptyID: input.ptyID, location: location(input) }, options)
      }, options),
    connect: {
      token: <Throw extends boolean = false>(input: PtyRemoveRequest, options?: AdapterOptions<Throw>) =>
        result(
          async () => ({
            ...(
              await client.pty.connect.token(
                { ptyID: input.ptyID, location: location(input), "x-opencode-ticket": "1" },
                options,
              )
            ).data,
            directory: input.directory ?? defaultDirectory,
          }),
          options,
        ),
    },
  }
}

/**
 * Facade surface for the transplanted script-terminal callers: methods pass the native
 * protocol input through verbatim and preserve the full native Location response
 * (`{location, data: Info}`) inside the result envelope, matching the
 * `created.data?.data` destructure the original `client.v2.pty.*` call sites use.
 */
export function createNativePtyMethods(client: OpenCodeClient, defaultDirectory: string) {
  const location = (input: { location?: { directory?: string; workspace?: string } }) =>
    input.location ?? { directory: defaultDirectory }
  return {
    create: <Throw extends boolean = false>(input: PtyCreateInput, options?: AdapterOptions<Throw>) =>
      result(
        async () =>
          await client.pty.create({ ...input, location: input.location ?? location(input) }, options),
        options,
      ),
    get: <Throw extends boolean = false>(input: PtyGetInput, options?: AdapterOptions<Throw>) =>
      result(
        async () => await client.pty.get({ ...input, location: input.location ?? location(input) }, options),
        options,
      ),
    update: <Throw extends boolean = false>(input: PtyUpdateInput, options?: AdapterOptions<Throw>) =>
      result(
        async () => await client.pty.update({ ...input, location: input.location ?? location(input) }, options),
        options,
      ),
    remove: <Throw extends boolean = false>(input: PtyRemoveInput, options?: AdapterOptions<Throw>) =>
      result(
        async () => {
          await client.pty.remove({ ...input, location: input.location ?? location(input) }, options)
        },
        options,
      ),
  }
}
