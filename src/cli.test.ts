import type { CommandContext, CommandResult } from './command'
import type { ArgvParser } from './parser'

import { toStandardJsonSchema as s } from '@valibot/to-json-schema'
import { describe, expect, it, vi } from 'vitest'

import * as v from 'valibot'

import { createCli } from './cli'
import { defineCommand, defineGlobalOptions } from './command'
import { DefinitionError, UsageError } from './errors'
import { cacParser } from './parsers/cac'
import { meowParser } from './parsers/meow'
import { nodeParser } from './parsers/node'
import { createTestIo } from './test-support'

type Run = (context: CommandContext) => CommandResult | Promise<CommandResult>

function createSampleCli(parser: ArgvParser, run: Run) {
  const globals = defineGlobalOptions({
    cache: { description: 'Use the cache', schema: s(v.optional(v.boolean(), true)) },
    config: { description: 'Config file', placeholder: 'path', schema: s(v.optional(v.string())), short: 'c' },
  })
  const lint = globals.defineCommand({
    args: '[...files]',
    default: true,
    description: 'Lint files',
    name: 'lint',
    options: {
      dirty: { description: 'Lint changed files only', schema: s(v.optional(v.boolean(), false)) },
      format: { description: 'Reporter', schema: s(v.optional(v.picklist(['stylish', 'json']), 'stylish')), short: 'f' },
      name: { schema: s(v.optional(v.pipe(v.string(), v.description('Run name')))) },
      retries: { description: 'Retry count', schema: s(v.optional(v.pipe(v.number(), v.integer(), v.minValue(0)))) },
      rule: { description: 'Rule filter', schema: s(v.optional(v.array(v.string()), [])) },
      timeoutMs: { description: 'Timeout', schema: s(v.optional(v.number())) },
    },
    run: context => run(context),
  })
  const ls = defineCommand({
    alias: ['list'],
    args: '[provider]',
    description: 'List providers',
    name: 'ls',
    options: {
      local: { description: 'Use project scope', schema: s(v.optional(v.boolean(), false)), short: 'l' },
    },
    run: context => run(context),
  })
  const providers = defineCommand({ commands: [ls], description: 'Manage providers', name: 'providers' })
  const config = defineCommand({ commands: [providers], description: 'Manage configuration', name: 'config' })

  return createCli({
    commands: [config, lint],
    description: 'AI-assisted linting.',
    name: 'alint',
    options: globals.options,
    parser,
    version: '1.2.3',
  })
}

describe.each([nodeParser, cacParser, meowParser])('parser contract: $name', (parser) => {
  async function invoke(argv: string[]) {
    const run = vi.fn<Run>(() => 0)
    const io = createTestIo()
    const exitCode = await createSampleCli(parser, run).run(argv, io)

    return { context: run.mock.calls[0]?.[0], exitCode, io, run }
  }

  it('routes bare positionals to the default command with defaults applied', async () => {
    const { context, exitCode } = await invoke(['src', 'test'])

    expect(exitCode).toBe(0)
    expect(context?.path).toEqual(['lint'])
    expect(context?.args).toEqual({ files: ['src', 'test'] })
    expect(context?.options).toEqual({ dirty: false, format: 'stylish', name: undefined, retries: undefined, rule: [], timeoutMs: undefined })
    expect(context?.globals).toEqual({ cache: true, config: undefined })
  })

  it('runs the default command when argv is empty', async () => {
    const { context } = await invoke([])

    expect(context?.path).toEqual(['lint'])
    expect(context?.args).toEqual({ files: [] })
  })

  it('parses long, short, inline, repeated, and number flags', async () => {
    const { context } = await invoke(['lint', '--dirty', '-f', 'json', '--rule', 'a', '--rule=b', '--timeout-ms', '500', 'src'])

    expect(context?.args).toEqual({ files: ['src'] })
    expect(context?.options).toEqual({ dirty: true, format: 'json', name: undefined, retries: undefined, rule: ['a', 'b'], timeoutMs: 500 })
  })

  it('keeps negative numbers as values', async () => {
    const { context } = await invoke(['--timeout-ms', '-5'])

    expect(context?.options.timeoutMs).toBe(-5)
  })

  it('keeps the last value of a repeated single-value flag', async () => {
    const { context } = await invoke(['-f', 'json', '-f', 'stylish'])

    expect(context?.options.format).toBe('stylish')
  })

  it('routes nested commands through aliases with globals before the command name', async () => {
    const { context } = await invoke(['-c', 'alint.config.ts', 'config', 'providers', 'list', 'openrouter', '-l'])

    expect(context?.path).toEqual(['config', 'providers', 'ls'])
    expect(context?.args).toEqual({ provider: 'openrouter' })
    expect(context?.options).toEqual({ local: true })
    expect(context?.globals).toEqual({ cache: true, config: 'alint.config.ts' })
  })

  it('negates booleans that default to true', async () => {
    const { context } = await invoke(['--no-cache', 'src'])

    expect(context?.globals.cache).toBe(false)
  })

  it('accepts a default command flag before any positional', async () => {
    const { context } = await invoke(['--dirty'])

    expect(context?.path).toEqual(['lint'])
    expect(context?.options.dirty).toBe(true)
  })

  it('binds tokens after -- as positionals without parsing them', async () => {
    const { context } = await invoke(['--', '--weird', 'config'])

    expect(context?.path).toEqual(['lint'])
    expect(context?.args).toEqual({ files: ['--weird', 'config'] })
    expect(context?.rest).toEqual(['--weird', 'config'])
  })

  it.skipIf(parser === cacParser)('keeps numeric-looking string values verbatim', async () => {
    const { context } = await invoke(['--name', '007'])

    expect(context?.options.name).toBe('007')
  })

  it.each([
    [['--timeout-ms', 'abc'], 'error: option --timeout-ms expects a number, received "abc"'],
    [['-f', 'xml'], 'error: option --format: Invalid type: Expected ("stylish" | "json") but received "xml"'],
    [['--retries', '1.5'], 'error: option --retries: Invalid integer: Received 1.5'],
    [['--nope'], 'error: unknown option --nope'],
    [['config', 'providers', 'ls', '--dirty'], 'error: unknown option --dirty'],
    [['--config'], 'error: option --config requires a value'],
    [['config', 'providers', 'ls', 'a', 'b'], 'error: unexpected argument "b"'],
  ])('reports %j as a usage error', async (argv, message) => {
    const { exitCode, io, run } = await invoke(argv)

    expect(exitCode).toBe(2)
    expect(io.stderrText().split('\n')[0]).toBe(message)
    expect(io.stderrText()).toContain('--help` for usage.')
    expect(run).not.toHaveBeenCalled()
  })
})

describe('createCli', () => {
  it('reports an unknown subcommand with the available commands', async () => {
    const io = createTestIo()
    const exitCode = await createSampleCli(nodeParser, () => 0).run(['config', 'nope'], io)

    expect(exitCode).toBe(2)
    expect(io.stderrText()).toBe([
      'error: unknown command "nope" for "alint config"',
      '',
      'Commands',
      '  providers <command>  Manage providers',
      '',
      'Run `alint config --help` for usage.',
      '',
    ].join('\n'))
  })

  it('reports a missing subcommand', async () => {
    const io = createTestIo()
    const exitCode = await createSampleCli(nodeParser, () => 0).run(['config'], io)

    expect(exitCode).toBe(2)
    expect(io.stderrText().split('\n')[0]).toBe('error: missing command for "alint config"')
  })

  it('prints only the version string', async () => {
    const io = createTestIo()

    expect(await createSampleCli(nodeParser, () => 0).run(['-v'], io)).toBe(0)
    expect(io.stdoutText()).toBe('1.2.3\n')
  })

  it('renders root help instead of running the default command', async () => {
    const io = createTestIo()
    const run = vi.fn<Run>()

    expect(await createSampleCli(nodeParser, run).run(['--help'], io)).toBe(0)
    expect(run).not.toHaveBeenCalled()
    expect(io.stdoutText()).toMatchInlineSnapshot(`
      "AI-assisted linting.

      Usage
        $ alint <command> [options]

      Commands
        config <command>  Manage configuration
        lint [...files]   Lint files (default)

      Options
            --no-cache       Use the cache
        -c, --config <path>  Config file
        -h, --help           Show help
        -v, --version        Show version
      "
    `)
  })

  it('renders leaf help with inherited options separated', async () => {
    const io = createTestIo()

    await createSampleCli(nodeParser, () => 0).run(['config', 'providers', 'ls', '-h'], io)

    expect(io.stdoutText()).toMatchInlineSnapshot(`
      "List providers

      Usage
        $ alint config providers ls [provider] [options]

      Options
        -l, --local  Use project scope

      Global Options
            --no-cache       Use the cache
        -c, --config <path>  Config file
        -h, --help           Show help
        -v, --version        Show version
      "
    `)
  })

  it('returns the exit code of the command', async () => {
    const exitCode = await createSampleCli(nodeParser, () => 3).run(['src'], createTestIo())

    expect(exitCode).toBe(3)
  })

  it('reports usage errors thrown by a command', async () => {
    const io = createTestIo()
    const exitCode = await createSampleCli(nodeParser, () => {
      throw new UsageError('--dirty does not accept files')
    }).run(['src'], io)

    expect(exitCode).toBe(2)
    expect(io.stderrText()).toBe('error: --dirty does not accept files\n\nRun `alint lint --help` for usage.\n')
  })

  it('rethrows other command errors', async () => {
    const cli = createSampleCli(nodeParser, () => {
      throw new Error('boom')
    })

    await expect(cli.run(['src'], createTestIo())).rejects.toThrow('boom')
  })

  it('passes the abort signal to the command', async () => {
    const run = vi.fn<Run>()
    const controller = new AbortController()

    await createSampleCli(nodeParser, run).run(['src'], createTestIo(), { signal: controller.signal })

    expect(run.mock.calls[0]?.[0].signal).toBe(controller.signal)
  })

  it('accepts undeclared flags when the command allows them', async () => {
    const run = vi.fn<Run>()
    const cli = createCli({
      allowUnknownOptions: true,
      args: '[...files]',
      description: 'Single command CLI',
      name: 'tool',
      run,
    })

    expect(await cli.run(['--extra', 'a'], createTestIo())).toBe(0)
    expect(run.mock.calls[0]?.[0].args).toEqual({ files: ['a'] })
  })
})

describe('createCli definition checks', () => {
  const leaf = (name: string, extra: object = {}) => defineCommand({ description: name, name, run: () => 0, ...extra })

  it.each([
    ['duplicate names', [leaf('a'), leaf('b', { alias: ['a'] })], 'more than one subcommand named "a"'],
    ['two defaults', [leaf('a', { default: true }), leaf('b', { default: true })], 'more than one default subcommand'],
    ['reserved short flag', [leaf('a', { options: { hidden: { schema: s(v.boolean()), short: 'h' } } })], 'reserved for help or version'],
    ['negation-shaped name', [leaf('a', { options: { noCache: { schema: s(v.boolean()) } } })], 'Declare "cache" with a default of true'],
    ['inherited clash', [defineCommand({ commands: [leaf('b', { options: { config: { schema: s(v.string()) } } })], description: '', name: 'a', options: { config: { schema: s(v.string()) } } })], 'clashes with option "config"'],
    ['bad argument pattern', [leaf('a', { args: '<a> files' })], 'Invalid argument "files"'],
  ])('rejects %s', (_, commands, message) => {
    expect(() => createCli({ commands, description: '', name: 'tool', version: '1.0.0' })).toThrow(DefinitionError)
    expect(() => createCli({ commands, description: '', name: 'tool', version: '1.0.0' })).toThrow(message)
  })
})

describe('option schemas', () => {
  it('rejects a schema without Standard JSON Schema when the CLI is created', () => {
    expect(() => createCli({
      description: '',
      name: 'tool',
      // @ts-expect-error A plain Valibot schema lacks `~standard.jsonSchema`; plain JavaScript callers can still pass one.
      options: { name: { schema: v.optional(v.string()) } },
    })).toThrow('option "name" of command "tool" needs a schema that implements Standard JSON Schema')
  })

  it('parses transformed schemas by their input side and passes the output to the command', async () => {
    const run = vi.fn<Run>()
    const cli = createCli({
      description: '',
      name: 'serve',
      options: { port: { schema: s(v.pipe(v.string(), v.transform(Number))) } },
      run,
    })

    await cli.run(['--port', '8080'], createTestIo())

    expect(run.mock.calls[0]?.[0].options).toEqual({ port: 8080 })
  })

  it('rejects schemas that argv cannot express', () => {
    expect(() => createCli({
      description: '',
      name: 'tool',
      options: { point: { schema: s(v.object({ x: v.number() })) } },
    })).toThrow('must be a boolean, number, string, or an array of numbers or strings')
  })

  it('reads choices from literal unions and descriptions from the schema in help', async () => {
    const io = createTestIo()
    const cli = createCli({
      description: 'Tool',
      name: 'tool',
      options: {
        level: { schema: s(v.optional(v.pipe(v.union([v.literal('low'), v.literal('high')]), v.description('Level')))) },
      },
      run: () => 0,
    })

    await cli.run(['--help'], io)

    expect(io.stdoutText()).toContain('--level <low|high>  Level')
  })
})
