import { KiloAccount } from "@kilocode/gateway-core"
import { createHmac } from "node:crypto"
import { define } from "@opencode/plugin/effect/plugin"
import type { RpcHandlers } from "@opencode/plugin/effect/rpc"
import { KiloHostedRpc } from "@opencode/schema/kilocode/hosted"
import { Effect } from "effect"
import { KiloGatewayAccounts } from "../gateway/accounts"
import { createCatalog } from "./catalog"
import { createCommandCatalog } from "./commands"
import { HostedError, HostedPreparing } from "./error"
import { createTerminals } from "./terminal"
import { streamSocket } from "./live-broadcast-ticket"
import { broadcastTypes } from "./live-broadcast"
import { createLive } from "./live"
import { createReview } from "./review"
import { createReviewSubmit } from "./review-submit"
import { createPreview } from "./preview"
import { createForkShare } from "./fork-share"
import { createManagement } from "./management"
import { createAttachments, createWithImages } from "./attachments"
import { projectRepository } from "./repository"
import { createTransport, deployment } from "./transport"

type Context = Parameters<RpcHandlers<typeof KiloHostedRpc.Definition>["status"]>[1]
type Access = {
  commands: ReturnType<typeof createCommandCatalog>
  forkShare: ReturnType<typeof createForkShare>
  preview: ReturnType<typeof createPreview>
  attachments: ReturnType<typeof createAttachments>
  management: ReturnType<typeof createManagement>
  review: ReturnType<typeof createReview>
  reviewSubmit: ReturnType<typeof createReviewSubmit>
  terminals: ReturnType<typeof createTerminals>
  catalog: ReturnType<typeof createCatalog>
  live: ReturnType<typeof createLive>
}

const stale = () => new HostedError("Cloud account or repository changed. Refresh the workspace.")
const sameAccount = (a: KiloAccount.Info, b?: KiloAccount.Info) =>
  a.token === b?.token && a.server === b.server && a.organizationID === b.organizationID

export function hostedLocation(directory: string, version: string) {
  const remote = projectRepository(directory)
  const lifetime = new AbortController()
  let observed = KiloGatewayAccounts.get(directory)
  let registered = KiloGatewayAccounts.registered(directory)
  let current:
    | (Access & {
        scope: string
        restoreKey: string
        remote: string
        account: KiloAccount.Info
        controller: AbortController
      })
    | undefined

  const invalidate = () => {
    current?.controller.abort()
    current?.live.close()
    current = undefined
  }
  const checked = async (scope: string, signal: AbortSignal) => {
    const status = await statusFor(signal)
    if (status.scope !== scope || !current || current.scope !== scope) throw stale()
    return current
  }
  const statusFor = async (signal: AbortSignal): Promise<KiloHostedRpc.Status> => {
    const account = KiloGatewayAccounts.get(directory)
    if (!account || account.token === KiloAccount.ANONYMOUS_KEY) {
      invalidate()
      return { state: KiloGatewayAccounts.registered(directory) ? "signed_out" : "starting" }
    }
    const origins = deployment(account, process.env)
    if (!origins) {
      invalidate()
      return { state: "unsupported" }
    }
    const repo = await remote(signal)
    signal.throwIfAborted()
    lifetime.signal.throwIfAborted()
    if (!sameAccount(account, KiloGatewayAccounts.get(directory))) throw stale()
    if (!repo) {
      invalidate()
      return { state: "no_repository" }
    }
    if (!current || current.remote !== repo || !sameAccount(account, current.account)) {
      invalidate()
      const scope = crypto.randomUUID()
      const controller = new AbortController()
      const request = createTransport(account, origins, version, controller.signal)
      const catalog = createCatalog(scope, repo, account.organizationID, request)
      const review = createReview(catalog.authorize, request)
      const attachments = createAttachments(account, origins.issuer)
      const live = createLive({
        openBroadcast: async (target, control, signal) => {
          await checked(scope, signal)
          if (scope !== target.scope || (await catalog.authorize(target, signal)) !== control) throw stale()
          return streamSocket(account, origins, control, broadcastTypes, signal)
        },
        sendImages: async (target, turn, signal) =>
          attachments.send(target, await catalog.authorize(target, signal), turn, signal),
        authorize: catalog.authorize,
        request: async (target, path, init) => {
          // Reconnects can run without a client attached to the RPC connection.
          await checked(scope, init.signal)
          if (target.scope !== scope) throw stale()
          return request(path, init)
        },
      })
      current = {
        scope,
        // Selection hint across process restarts, never accepted as an RPC authorization scope.
        restoreKey: createHmac("sha256", account.token)
          .update(JSON.stringify(["cloud-selection", account.server, account.organizationID, repo, origins]))
          .digest("hex"),
        remote: repo,
        account,
        controller,
        catalog,
        commands: createCommandCatalog(account, origins, catalog.authorize),
        live,
        terminals: createTerminals(account, origins, catalog.authorize, controller.signal, catalog.readySibling),
        review,
        reviewSubmit: createReviewSubmit(account, origins.issuer, catalog, review),
        management: createManagement(account, origins.issuer, catalog.authorize, request),
        preview: createPreview(account, origins, catalog.authorize),
        forkShare: createForkShare(account, origins.issuer, repo, catalog.authorize, request),
        attachments,
      }
    }
    return { state: "ready", scope: current.scope, restoreKey: current.restoreKey, repository: repo }
  }
  return {
    status: statusFor,
    changed() {
      const account = KiloGatewayAccounts.get(directory)
      const ready = KiloGatewayAccounts.registered(directory)
      const changed = ready !== registered || (observed ? !sameAccount(observed, account) : account !== undefined)
      observed = account
      registered = ready
      if (current && !sameAccount(current.account, account)) invalidate()
      return changed
    },
    close() {
      lifetime.abort()
      invalidate()
    },
    async scoped<A>(scope: string, signal: AbortSignal, use: (access: Access, signal: AbortSignal) => Promise<A>) {
      const access = await checked(scope, signal)
      const result = await use(access, AbortSignal.any([signal, access.controller.signal]))
      // Never publish a cached transcript or in-flight result to a different account.
      await checked(scope, signal)
      return result
    },
  }
}

export const KiloHostedPlugin = define({
  id: "kilocode.hosted",
  effect: Effect.fn(function* (ctx) {
    const directory = ctx.location.directory
    const host = hostedLocation(directory, ctx.app.version)
    const run = <A>(context: Context, work: (signal: AbortSignal) => Promise<A>) =>
      Effect.tryPromise({
        try: work,
        catch: (error) =>
          context.error(
            error instanceof HostedPreparing ? "HostedPreparing" : "HostedError",
            error instanceof HostedError ? error.message : "Cloud request failed. Check your connection and retry.",
          ),
      })
    const call = <A>(context: Context, scope: string, use: (access: Access, signal: AbortSignal) => Promise<A>) =>
      run(context, (signal) => host.scoped(scope, signal, use))
    const registration = yield* ctx.rpc
      .register(KiloHostedRpc.Definition, {
        forkSession: (i, c) => call(c, i.target.scope, (a, s) => a.forkShare.fork(i.target, i.operationKey, s)),
        snapshotOptions: (i, c) => call(c, i.target.scope, (a, s) => a.forkShare.snapshotOptions(i.target, s)),
        publishSnapshot: (i, c) =>
          call(c, i.target.scope, (a, s) => a.forkShare.publishSnapshot(i.target, i.confirmation, s)),
        previewOptions: (i, c) => call(c, i.target.scope, (a, s) => a.preview.options(i.target, s)),
        openPreview: (i, c) => call(c, i.target.scope, (a, s) => a.preview.open(i.target, i.port, s, i.path)),
        stageImage: (i, c) => call(c, i.scope, (a, s) => a.attachments.stage(i.messageID, i.image, s)),
        sessionInfo: (i, c) => call(c, i.target.scope, (a, s) => a.management.info(i.target, s)),
        renameSession: (i, c) => call(c, i.target.scope, (a, s) => a.management.rename(i.target, i.title, s)),
        deleteSession: (i, c) => call(c, i.target.scope, (a, s) => a.management.remove(i.target, i.operationKey, s)),
        reviewChanges: (i, c) => call(c, i.target.scope, (a, s) => a.review.changes(i, s)),
        reviewFile: (i, c) => call(c, i.target.scope, (a, s) => a.review.file(i, s)),
        reviewDestinations: (i, c) => call(c, i.target.scope, (a, s) => a.reviewSubmit.destinations(i.target, s)),
        sendReview: (i, c) => call(c, i.target.scope, (a, s) => a.reviewSubmit.send(i, s)),
        reviewDelivery: (i, c) => call(c, i.target.scope, (a, s) => a.reviewSubmit.delivery(i, s)),
        terminalOpen: (i, c) => call(c, i.target.scope, (a, s) => a.terminals.open(i, s)),
        terminalRead: (i, c) => call(c, i.target.scope, (a, s) => a.terminals.read(i, s)),
        terminalWrite: (i, c) => call(c, i.target.scope, async (a) => a.terminals.write(i)),
        terminalResize: (i, c) => call(c, i.target.scope, (a, s) => a.terminals.resize(i, s)),
        terminalClose: (i, c) => call(c, i.target.scope, async (a) => a.terminals.close(i)),
        status: (_, ctx) => run(ctx, host.status),
        list: (input, ctx) => call(ctx, input.scope, (a, signal) => a.catalog.list(input, signal)),
        workspace: (input, ctx) => call(ctx, input.scope, (a, signal) => a.catalog.workspace(input, signal)),
        profiles: (input, ctx) => call(ctx, input.scope, (a, signal) => a.catalog.profiles(signal)),
        create: (input, ctx) =>
          call(ctx, input.scope, (a, signal) => createWithImages(input, a.catalog, a.attachments, signal)),
        start: (input, ctx) => call(ctx, input.scope, (a, signal) => a.catalog.start(input, signal)),
        attach: (input, ctx) => call(ctx, input.target.scope, (a, signal) => a.live.attach(input, signal)),
        read: (input, ctx) => call(ctx, input.target.scope, (a, signal) => a.live.read(input, signal)),
        history: (input, ctx) => call(ctx, input.target.scope, (a, signal) => a.live.history(input, signal)),
        prompt: (input, ctx) => call(ctx, input.target.scope, (a, signal) => a.live.prompt(input, signal)),
        command: (input, ctx) => call(ctx, input.target.scope, (a, signal) => a.live.command(input, signal)),
        commands: (input, ctx) => call(ctx, input.target.scope, (a, signal) => a.commands(input.target, signal)),
        cancelQueued: (input, ctx) =>
          call(ctx, input.target.scope, (a, signal) => a.catalog.cancelQueued(input.target, input.messageID, signal)),
        interrupt: (input, ctx) => call(ctx, input.target.scope, (a, signal) => a.live.interrupt(input, signal)),
        childHistory: (input, ctx) => call(ctx, input.target.scope, (a, signal) => a.live.childHistory(input, signal)),
        replyQuestion: (input, ctx) =>
          call(ctx, input.target.scope, (a, signal) => a.live.replyQuestion(input, signal)),
        rejectQuestion: (input, ctx) =>
          call(ctx, input.target.scope, (a, signal) => a.live.rejectQuestion(input, signal)),
        replyPermission: (input, ctx) =>
          call(ctx, input.target.scope, (a, signal) => a.live.replyPermission(input, signal)),
        detach: (input, ctx) => call(ctx, input.target.scope, (a, signal) => a.live.detach(input, signal)),
      })
      .pipe(Effect.orDie)
    const unsubscribe = KiloGatewayAccounts.subscribe(directory, () => {
      // A catalog refresh for the same user leaves their open chat attached.
      if (host.changed()) Effect.runFork(registration.events.emit("changed", {}).pipe(Effect.ignore))
    })
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        unsubscribe()
        host.close()
      }),
    )
  }),
})
