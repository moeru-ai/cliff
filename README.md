# Cliff

[![npm version][npmx-version-src]][npmx-version-href]
[![npm downloads][npmx-downloads-src]][npmx-downloads-href]
[![bundle][bundle-src]][bundle-href]
[![License][license-src]][license-href]
[![JSDocs][jsdocs-src]][jsdocs-href]

Command tree orchestration for Node.js CLIs. You declare commands with flags written the way help shows them (`-c, --config <path>`), and cliff infers their types from those strings. cliff routes argv, renders help, reports usage errors, and calls your action with an injected `io`. Flags can carry any [Standard Schema](https://standardschema.dev) (Valibot, Zod, ArkType, ...) for validation and transforms. The actual flag parsing is delegated to a pluggable parser: `node:util` `parseArgs` (default), [cac](https://github.com/cacjs/cac), or [meow](https://github.com/sindresorhus/meow).

cac and meow parse flags well, but nested subcommands, per-command help, exit codes, and testable I/O are left to every project. In practice each CLI grows its own layer on top: hand-written dispatch, help callbacks, hard-coded lists of value-taking flags, `console.log` interception. cliff is that layer, written once.

<!-- START doctoc generated TOC please keep comment here to allow auto update -->
<!-- DON'T EDIT THIS SECTION, INSTEAD RE-RUN doctoc TO UPDATE -->
## Table of Contents

- [Installation and Usage](#installation-and-usage)
  - [Install](#install)
  - [Define commands](#define-commands)
  - [Run](#run)
  - [Help and usage errors](#help-and-usage-errors)
  - [Test](#test)
  - [Cancel](#cancel)
  - [Use another parser](#use-another-parser)
- [Flags](#flags)
- [Arguments](#arguments)
- [Concepts](#concepts)
- [Parsers](#parsers)
- [API at a glance](#api-at-a-glance)
- [When to use](#when-to-use)
- [When not to use](#when-not-to-use)
- [Documentation automation](#documentation-automation)
- [Development](#development)
- [Status](#status)
- [License](#license)

<!-- END doctoc generated TOC please keep comment here to allow auto update -->

## Installation and Usage

### Install

```sh
npm install @moeru/cliff
pnpm add @moeru/cliff
```

cliff needs Node.js 22.4 or later. cac and meow are optional peer dependencies: install one only to use its parser.

### Define commands

A command is a name, a description, its flags and arguments, and either an `action` or `children`. The types of `flags` come from their spellings, and the types of `args` from their fields:

<!-- docs:example examples/tool.ts -->
```ts
import { createCli, defineCommand, defineFlags } from '@moeru/cliff'

import * as v from 'valibot'

// A shared set is just an array; spread it into every command that accepts it.
const sharedFlags = defineFlags([
  { description: 'Config file', flag: '-c, --config <path>' },
  { description: 'Disable the cache', flag: '--no-cache' },
])

const lint = defineCommand({
  action: async ({ args, flags, io, signal }) => {
    // args.files: string[]
    // flags.config: string | undefined, flags.cache: boolean, flags.dirty: boolean
    // flags.format: 'stylish' | 'json', flags.rule: string[], flags.retries: number | undefined
    signal.throwIfAborted()
    io.stdout.write(`linting ${args.files.join(', ')} with ${flags.format}\n`)
    return 0
  },
  arguments: [{ description: 'Files to lint', name: 'files', variadic: true }],
  default: true, // `tool src` runs `tool lint src`
  description: 'Lint files',
  flags: [
    ...sharedFlags,
    { description: 'Lint changed files only', flag: '--dirty' },
    { default: 'stylish', description: 'Reporter', flag: '-f, --format <stylish|json>' },
    { description: 'Only run matching rules', flag: '--rule <pattern...>' },
    { description: 'Retry count', flag: '--retries <n>', schema: v.optional(v.pipe(v.string(), v.toNumber(), v.integer())) },
  ],
  name: 'lint',
})

const ls = defineCommand({
  action: ({ args, flags, io }) => {
    io.stdout.write(`${args.provider ?? 'all providers'} (${flags.local ? 'project' : 'global'})\n`)
  },
  arguments: [{ description: 'Provider to list', name: 'provider' }],
  description: 'List providers',
  flags: [...sharedFlags, { description: 'Use project scope', flag: '-l, --local' }],
  name: 'ls',
})
const providers = defineCommand({ children: [ls], description: 'Manage providers', name: 'providers' })

export const cli = createCli({
  children: [providers, lint],
  description: 'An example tool.',
  name: 'tool',
  version: '1.0.0',
})
```
<!-- /docs:example -->

### Run

`cli.run()` is the process entrypoint. Call it once from the bin file:

<!-- docs:example examples/bin.ts -->
```ts
import { cli } from './tool.ts'

cli.run()
```
<!-- /docs:example -->

It passes `process.argv.slice(2)` and the real stdio, and sets `process.exitCode`. On the first SIGINT/SIGTERM it aborts `context.signal`; an action that rejects with the abort reason exits with `128 + signal number` (130 for Ctrl+C) and no message. If an action throws anything else, it prints `<name>: <message>` and exits with code 1.

### Help and usage errors

cliff renders help for every command from the definitions, so it cannot drift from what the command accepts:

<!-- docs:output tool --help -->
```console
$ tool --help
An example tool.

Usage
  $ tool <command> [flags]

Commands
  providers <command>  Manage providers
  lint [...files]      Lint files (default)

Flags
  -h, --help     Show help
  -v, --version  Show version
```
<!-- /docs:output -->

<!-- docs:output tool lint --help -->
```console
$ tool lint --help
Lint files

Usage
  $ tool lint [...files] [flags]

Arguments
  [...files]  Files to lint

Flags
  -c, --config <path>          Config file
      --no-cache               Disable the cache
      --dirty                  Lint changed files only
  -f, --format <stylish|json>  Reporter (default: stylish)
      --rule <pattern...>      Only run matching rules (repeatable)
      --retries <n>            Retry count
  -h, --help                   Show help
  -v, --version                Show version
```
<!-- /docs:output -->

Usage mistakes go to stderr with a `--help` hint and exit with code 2. Choices and schemas are checked before the action runs:

<!-- docs:output tool lint --format xml -->
```console
$ tool lint --format xml
error: flag --format must be one of stylish, json, received "xml"

Run `tool lint --help` for usage.
```
<!-- /docs:output -->

<!-- docs:output tool --retries 1.5 -->
```console
$ tool --retries 1.5
error: flag --retries: Invalid integer: Received 1.5

Run `tool lint --help` for usage.
```
<!-- /docs:output -->

<!-- docs:output tool providers -->
```console
$ tool providers
error: missing command for "tool providers"

Commands
  ls [provider]  List providers

Run `tool providers --help` for usage.
```
<!-- /docs:output -->

### Test

`cli.execute(argv, io)` touches no `process` state and resolves to the exit code. `io` only needs `stdout` and `stderr`; `createMemoryIo` from `@moeru/cliff/testing` captures both:

<!-- docs:example examples/tool.test.ts -->
```ts
import { createMemoryIo } from '@moeru/cliff/testing'
import { expect, it } from 'vitest'

import { cli } from './tool.ts'

it('lists providers in the global scope', async () => {
  const io = createMemoryIo({ cwd: '/project' })

  expect(await cli.execute(['providers', 'ls', 'openrouter'], io)).toBe(0)
  expect(io.stdout.text()).toBe('openrouter (global)\n')
})
```
<!-- /docs:example -->

### Cancel

Both `cli.run({ signal })` and `cli.execute(argv, io, { signal })` accept an `AbortSignal`, and `context.signal` is always set. Under `run`, the caller's signal is combined with SIGINT/SIGTERM:

```ts
await cli.run({ signal: AbortSignal.timeout(30_000) })
```

An aborted signal stops cliff before the action runs and rejects `execute` with `signal.reason`. Abort is checked between flag validations, but an async schema that is already running cannot be cancelled, because Standard Schema's `validate` takes no signal. Once the action runs, stopping is up to it: pass `signal` to `fetch`, child processes, and timers, or call `signal.throwIfAborted()`.

### Use another parser

Pass it to `createCli`:

```ts
import { cacParser } from '@moeru/cliff/parsers/cac'

createCli({ /* ... */ parser: cacParser })
```

## Flags

The flag spelling decides how the flag is parsed and what type the action receives:

| Spelling | Absent | Value type |
|---|---|---|
| `--dirty` | `false` | `boolean` |
| `--no-cache` | `true` | `boolean`, keyed `cache` |
| `-c, --config <path>` | `undefined` | `string \| undefined` |
| `--format <stylish\|json>` | `undefined` | `'stylish' \| 'json' \| undefined`, other values are a usage error |
| `--rule <pattern...>` | `[]` | `string[]`, repeatable |

Keys are the camelCase long name: `--timeout-ms` becomes `timeoutMs`. `default` replaces the absent value and removes `undefined` from the type.

`schema` is any Standard Schema. It receives the parsed value, or the default when the flag is absent. Its output is what the action sees, and the action's type comes from it, as in `v.pipe(v.string(), v.toNumber())`. A failure is a usage error, as shown in [Help and usage errors](#help-and-usage-errors).

Flags are not inherited. Each command accepts exactly the flags it declares, so shared flags are spread in with `defineFlags`. A shared flag may still be typed before the command name (`tool -c x providers ls`).

## Arguments

Positional arguments are declared in order, with explicit fields:

```ts
arguments: [
  { description: 'Port to listen on', name: 'port', required: true, schema: v.pipe(v.string(), v.toNumber(), v.integer()) },
  { default: 'dev', description: 'Run mode', name: 'mode', schema: v.picklist(['dev', 'prod']) },
  { description: 'Files to serve', name: 'files', variadic: true },
]
// args: { port: number, mode: 'dev' | 'prod', files: string[] }
```

| Fields | Absent | Value type without `schema` | Help |
|---|---|---|---|
| `required: true` | usage error | `string` | `<name>` |
| (none) | `undefined` | `string \| undefined` | `[name]` |
| `variadic: true` | `[]` | `string[]`, every remaining positional | `[...name]` |
| `required: true, variadic: true` | usage error | `string[]`, at least one | `<...name>` |

Keys are the camelCase name: `report-path` becomes `reportPath`. `default` replaces the absent value and removes `undefined` from the type. `schema` works as it does for flags: it receives the bound value or the default, its output is what the action sees, and a failure is a usage error such as `error: argument <port>: Invalid type`.

Arguments bind left to right, so only the last argument may be variadic, and a required argument cannot follow an optional one. Extra positionals are a usage error. Help lists each argument with its description and default.

## Concepts

| Concept | Behavior |
|---|---|
| Routing | The first positional that names a child selects it. Otherwise, a `default: true` child receives it. |
| Built-ins | `-h`/`--help` prints help for the selected command. `-v`/`--version` is enabled by `version`. Both are reserved. |
| Exit codes | The value returned by `action` (nothing means 0). Help and version exit 0. Usage errors, including a `UsageError` thrown by an action, exit 2. Other errors are rethrown. |
| `--` | Later tokens are not parsed. They are bound to positionals and also exposed as `context.rest`. |
| Definition errors | Malformed spellings or argument names, duplicate keys or short flags, arguments in an impossible order, reserved names, and ambiguous trees throw `DefinitionError` from `createCli`. |

## Parsers

cliff routes, validates, and normalizes. A parser only splits one command's argv into flags and positionals. Before calling a parser, cliff rewrites known value flags to `--flag=value` and expands short clusters. This removes the main differences between libraries: negative numbers, `-` as a value, and `-abc` clusters.

| Parser | Import | Dependency | Notes |
|---|---|---|---|
| node | `@moeru/cliff/parsers/node` (default) | none | `util.parseArgs`. Needs Node 22.4+ for `allowNegative`. |
| cac | `@moeru/cliff/parsers/cac` | `cac` peer | mri casts numeric-looking string values, so `--name 007` arrives as `"7"`. |
| meow | `@moeru/cliff/parsers/meow` | `meow` peer | `process.exit` paths and the `process.title` side effect are avoided. |

An unknown flag only reaches a parser when the command sets `allowUnknownFlags`. In that case, parsers may disagree on whether `--unknown value` consumes `value`.

## API at a glance

| API | What it does | Section |
|---|---|---|
| `createCli(definition)` | Validates the command tree and returns a `Cli`. `parser` and `version` are set here. | [Define commands](#define-commands) |
| `defineCommand(definition)` | Declares a command: `name`, `description`, `flags`, `arguments`, `action` or `children`, `alias`, `default` | [Define commands](#define-commands) |
| `defineFlags(flags)` | Keeps a shared flag set typed so it can be spread into several commands | [Flags](#flags) |
| `arguments` in `defineCommand` | Positional arguments: `name`, `description`, `required`, `variadic`, `default`, `schema` | [Arguments](#arguments) |
| `cli.run({ argv?, signal? })` | Runs as the process entrypoint and sets `process.exitCode` | [Run](#run) |
| `cli.execute(argv, io, { signal? })` | Runs one invocation without `process` and resolves to the exit code | [Test](#test) |
| `context` in `action` | `args`, `flags`, `io`, `path`, `rest`, `signal` | [Define commands](#define-commands) |
| `UsageError` | Thrown by an action for a usage mistake the definitions cannot express; exits 2 | [Concepts](#concepts) |
| `DefinitionError` | Thrown by `createCli` for a broken tree | [Concepts](#concepts) |
| `createMemoryIo(overrides?)` from `@moeru/cliff/testing` | In-memory `io` whose `stdout.text()` and `stderr.text()` return what was written | [Test](#test) |
| `nodeParser`, `cacParser`, `meowParser` from `@moeru/cliff/parsers/*` | The argv parsers | [Parsers](#parsers) |
| `ArgvParser` | The contract a custom parser implements | [Parsers](#parsers) |

## When to use

- A Node.js CLI with nested subcommands, shared flags, and per-command help.
- Migrating a cac or meow CLI step by step: keep the parser you already use and replace the hand-written routing around it.
- Tests that need to run the full CLI in-process and assert on output and exit codes.

## When not to use

- Single-flag scripts. `util.parseArgs` alone is enough.
- Flags with optional values (`--color [when]`) or nested dot options (`--a.b`). Neither is supported yet.
- Interactive prompts, spinners, or TUI layout. cliff only ends where a command's `action` begins.
- Shell completion generation or plugin auto-discovery. These are not implemented yet.

## Documentation automation

The table of contents comes from `doctoc`. The example code and every help or error output in this README come from [`examples/`](./examples): they are type-checked with the source, and the outputs are what the example CLI prints when it runs. Run this after you change a heading, `examples/`, or anything that changes output:

```sh
pnpm docs:update
```

`docs:update` refreshes the table of contents, builds the package, and then rewrites the regions between `<!-- docs:example <file> -->` or `<!-- docs:output <argv> -->` and their closing comments. Do not edit those regions by hand. `pnpm docs:check` fails when they are out of date.

## Development

```sh
pnpm install
pnpm test:run   # unit, parser contract, and type tests
pnpm typecheck
pnpm lint
pnpm spellcheck
pnpm build
node examples/bin.ts --help   # the example CLI, after a build
```

## Status

cliff is at 0.x and is not published to npm yet. The API can still change between minor versions.

## License

[MIT](./LICENSE)

[npmx-version-src]: https://npmx.dev/api/registry/badge/version/@moeru/cliff
[npmx-version-href]: https://npmx.dev/@moeru/cliff
[npmx-downloads-src]: https://npmx.dev/api/registry/badge/downloads-month/@moeru/cliff
[npmx-downloads-href]: https://npmx.dev/@moeru/cliff
[bundle-src]: https://npmx.dev/api/registry/badge/size/@moeru/cliff
[bundle-href]: https://bundlephobia.com/result?p=@moeru/cliff
[license-src]: https://npmx.dev/api/registry/badge/license/@moeru/cliff
[license-href]: https://github.com/moeru-ai/cliff/blob/main/LICENSE
[jsdocs-src]: https://img.shields.io/badge/jsdocs-reference-080f12?style=flat&colorA=080f12&colorB=1fa669
[jsdocs-href]: https://www.jsdocs.io/package/@moeru/cliff
