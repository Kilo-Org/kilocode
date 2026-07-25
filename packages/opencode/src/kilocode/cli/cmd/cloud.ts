import type { Argv } from "yargs"
import { Effect } from "effect"
import { cmd } from "@/cli/cmd/cmd"
import { effectCmd } from "@/cli/effect-cmd"
import { CloudCommands } from "@/kilocode/cloud/commands"

export const CloudStartCommand = effectCmd({
  command: "start",
  describe: "start a Cloud Agent task",
  builder: (yargs) =>
    yargs
      .option("prompt", {
        type: "string",
        demandOption: true,
        describe: "prompt for the Cloud Agent",
      })
      .option("repo", {
        type: "string",
        describe: "repository shorthand or URL",
      })
      .option("repo-type", {
        type: "string",
        choices: ["github", "gitlab", "git"] as const,
        describe: "repository provider type",
      })
      .option("branch", {
        type: "string",
        describe: "repository branch",
      })
      .option("model", {
        type: "string",
        describe: "Cloud Agent model",
      })
      .option("mode", {
        type: "string",
        describe: "Cloud Agent mode",
      })
      .option("org-id", {
        type: "string",
        describe: "Kilo organization ID",
      })
      .option("stream", {
        type: "boolean",
        describe: "connect to the WebSocket stream and print events as JSONL",
      }),
  handler: Effect.fn("Cli.cloud.start")(function* (args) {
    yield* CloudCommands.start({
      prompt: args.prompt,
      ...(args.repo === undefined ? {} : { repo: args.repo }),
      ...(args.repoType === undefined ? {} : { repoType: args.repoType }),
      ...(args.branch === undefined ? {} : { branch: args.branch }),
      ...(args.model === undefined ? {} : { model: args.model }),
      ...(args.mode === undefined ? {} : { mode: args.mode }),
      ...(args.orgId === undefined ? {} : { orgID: args.orgId }),
      ...(args.stream === undefined ? {} : { stream: args.stream }),
    })
  }),
})

export const CloudSendCommand = effectCmd({
  command: "send",
  describe: "send a follow-up prompt to a Cloud Agent task",
  instance: false,
  builder: (yargs) =>
    yargs
      .option("session-id", {
        type: "string",
        demandOption: true,
        describe: "Cloud Agent session ID",
      })
      .option("prompt", {
        type: "string",
        demandOption: true,
        describe: "follow-up prompt for the Cloud Agent",
      }),
  handler: Effect.fn("Cli.cloud.send")(function* (args) {
    yield* CloudCommands.send({ sessionID: args.sessionId, prompt: args.prompt })
  }),
})

export const CloudStatusCommand = effectCmd({
  command: "status",
  describe: "show Cloud Agent task status",
  instance: false,
  builder: (yargs) =>
    yargs
      .option("session-id", {
        type: "string",
        demandOption: true,
        describe: "Cloud Agent session ID",
      })
      .option("message-id", {
        type: "string",
        demandOption: true,
        describe: "Cloud Agent message ID",
      }),
  handler: Effect.fn("Cli.cloud.status")(function* (args) {
    yield* CloudCommands.status({ sessionID: args.sessionId, messageID: args.messageId })
  }),
})

export const CloudResultCommand = effectCmd({
  command: "result",
  describe: "show a Cloud Agent task result",
  instance: false,
  builder: (yargs) =>
    yargs
      .option("session-id", {
        type: "string",
        demandOption: true,
        describe: "Cloud Agent session ID",
      })
      .option("message-id", {
        type: "string",
        demandOption: true,
        describe: "Cloud Agent message ID",
      }),
  handler: Effect.fn("Cli.cloud.result")(function* (args) {
    yield* CloudCommands.result({ sessionID: args.sessionId, messageID: args.messageId })
  }),
})

export const CloudCommand = cmd({
  command: "cloud",
  describe: "run Cloud Agent tasks",
  builder: (yargs: Argv) =>
    yargs
      .command(CloudStartCommand)
      .command(CloudSendCommand)
      .command(CloudStatusCommand)
      .command(CloudResultCommand)
      .demandCommand(),
  async handler() {},
})
