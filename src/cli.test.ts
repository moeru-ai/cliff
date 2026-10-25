import type { CommandContext, CommandResult } from './command'
import type { ArgvParser } from './parser'

import { describe, expect, it, vi } from 'vitest'

import * as v from 'valibot'

import { createCli } from './cli'
import { defineCommand } from './command'
import { DefinitionError, UsageError } from './errors'
import { defineFlags } from './flags'
import { cacParser } from './parsers/cac'
import { meowParser } from './parsers/meow'
import { nodeParser } from './parsers/node'
import { createMemoryIo } from './testing'

type Run = (context: CommandContext) => CommandResult | Promise<CommandResult>

const sharedFlags = defineFlags([
  { description: 'Config file', flag: '-c, --config <path>' },
  { description: 'Disable the cache', flag: '--no-cache' },
])

function createSampleCli(parser: ArgvParser, run: Run) {
  const lint = defineCommand({
    action: context => run(context),
    arguments: '[...files]',
    default: true,
    description: 'Lint files',
    flags: [
      ...sharedFlags,
      { description: 'Lint changed files only', flag: '--dirty' },
      { default: 'stylish', description: 'Reporter', flag: '-f, --format <stylish|json>' },
      { description: 'Run name', flag: '--name <name>' },
      { description: 'Retry count', flag: '--retries <n>', schema: v.optional(v.pipe(v.string(), v.toNumber(), v.integer(), v.minValue(0))) },
      { description: 'Rule filter', flag: '--rule <pattern...>' },
      { description: 'Timeout', flag: '--timeout-ms <ms>', schema: v.optional(v.pipe(v.string(), v.toNumber())) },
    ],
    name: 'lint',
  })
  const ls = defineCommand({
    action: context => run(context),
    alias: ['list'],
    arguments: '[provider]',
    description: 'List providers',
    flags: [
      ...sharedFlags,
      { description: 'Use project scope', flag: '-l, --local' },
    ],
    name: 'ls',
  })
  const providers = defineCommand({ children: [ls], description: 'Manage providers', name: 'providers' })
  const config = defineCommand({ children: [providers], description: 'Manage configuration', name: 'config' })

  return createCli({
    children: [config, lint],
    description: 'AI-assisted linting.',
    name: 'alint',
    parser,
    version: '1.2.3',
  })
}

describe.each([nodeParser, cacParser, meowParser])('parser contract: $name', (parser) => {
  async function invoke(argv: string[]) {
    const run = vi.fn<Run>(() => 0)
    const io = createMemoryIo()
    const exitCode = await createSampleCli(parser, run).run(argv, io)

    return { context: run.mock.calls[0]?.[0], exitCode, io, run }
  }

  it('routes bare positionals to the default command with defaults applied', async () => {
    const { context, exitCode } = await invoke(['src', 'test'])

    expect(exitCode).toBe(0)
    expect(context?.path).toEqual(['lint'])
    expect(context?.args).toEqual({ files: ['src', 'test'] })
    expect(context?.flags).toEqual({ cache: true, config: undefined, dirty: false, format: 'stylish', name: undefined, retries: undefined, rule: [], timeoutMs: undefined })
  })

  it('runs the default command when argv is empty', async () => {
    const { context } = await invoke([])

    expect(context?.path).toEqual(['lint'])
    expect(context?.args).toEqual({ files: [] })
  })

  it('parses long, short, inline, repeated, and number flags', async () => {
    const { context } = await invoke(['lint', '--dirty', '-f', 'json', '--rule', 'a', '--rule=b', '--timeout-ms', '500', 'src'])

    expect(context?.args).toEqual({ files: ['src'] })
    expect(context?.flags).toEqual({ cache: true, config: undefined, dirty: true, format: 'json', name: undefined, retries: undefined, rule: ['a', 'b'], timeoutMs: 500 })
  })

  it('keeps negative numbers as values', async () => {
    const { context } = await invoke(['--timeout-ms', '-5'])

    expect(context?.flags.timeoutMs).toBe(-5)
  })

  it('keeps the last value of a repeated single-value flag', async () => {
    const { context } = await invoke(['-f', 'json', '-f', 'stylish'])

    expect(context?.flags.format).toBe('stylish')
  })

  it('routes nested commands through aliases with shared flags before the command name', async () => {
    const { context } = await invoke(['-c', 'alint.config.ts', 'config', 'providers', 'list', 'openrouter', '-l'])

    expect(context?.path).toEqual(['config', 'providers', 'ls'])
    expect(context?.args).toEqual({ provider: 'openrouter' })
    expect(context?.flags).toEqual({ cache: true, config: 'alint.config.ts', local: true })
  })

  it('turns a --no- flag off', async () => {
    const { context } = await invoke(['--no-cache', 'src'])

    expect(context?.flags.cache).toBe(false)
  })

  it('accepts a default command flag before any positional', async () => {
    const { context } = await invoke(['--dirty'])

    expect(context?.path).toEqual(['lint'])
    expect(context?.flags.dirty).toBe(true)
  })

  it('binds tokens after -- as positionals without parsing them', async () => {
    const { context } = await invoke(['--', '--weird', 'config'])

    expect(context?.path).toEqual(['lint'])
    expect(context?.args).toEqual({ files: ['--weird', 'config'] })
    expect(context?.rest).toEqual(['--weird', 'config'])
  })

  it.skipIf(parser === cacParser)('keeps numeric-looking string values verbatim', async () => {
    const { context } = await invoke(['--name', '007'])

    expect(context?.flags.name).toBe('007')
  })

  it.each([
    [['-f', 'xml'], 'error: flag --format must be one of stylish, json, received "xml"'],
    [['--retries', '1.5'], 'error: flag --retries: Invalid integer: Received 1.5'],
    [['--nope'], 'error: unknown flag --nope'],
    [['config', 'providers', 'ls', '--dirty'], 'error: unknown flag --dirty'],
    [['--config'], 'error: flag --config requires a value'],
    [['config', 'providers', 'ls', 'a', 'b'], 'error: unexpected argument "b"'],
  ])('reports %j as a usage error', async (argv, message) => {
    const { exitCode, io, run } = await invoke(argv)

    expect(exitCode).toBe(2)
    expect(io.stderr.text().split('\n')[0]).toBe(message)
    expect(io.stderr.text()).toContain('--help` for usage.')
    expect(run).not.toHaveBeenCalled()
  })
})

describe('createCli', () => {
  it('reports an unknown subcommand with the available commands', async () => {
    const io = createMemoryIo()
    const exitCode = await createSampleCli(nodeParser, () => 0).run(['config', 'nope'], io)

    expect(exitCode).toBe(2)
    expect(io.stderr.text()).toBe([
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
    const io = createMemoryIo()
    const exitCode = await createSampleCli(nodeParser, () => 0).run(['config'], io)

    expect(exitCode).toBe(2)
    expect(io.stderr.text().split('\n')[0]).toBe('error: missing command for "alint config"')
  })

  it('prints only the version string', async () => {
    const io = createMemoryIo()

    expect(await createSampleCli(nodeParser, () => 0).run(['-v'], io)).toBe(0)
    expect(io.stdout.text()).toBe('1.2.3\n')
  })

  it('renders root help instead of running the default command', async () => {
    const io = createMemoryIo()
    const run = vi.fn<Run>()

    expect(await createSampleCli(nodeParser, run).run(['--help'], io)).toBe(0)
    expect(run).not.toHaveBeenCalled()
    expect(io.stdout.text()).toMatchInlineSnapshot(`
      "AI-assisted linting.

      Usage
        $ alint <command> [flags]

      Commands
        config <command>  Manage configuration
        lint [...files]   Lint files (default)

      Flags
        -h, --help     Show help
        -v, --version  Show version
      "
    `)
  })

  it('renders leaf help with flags as written', async () => {
    const io = createMemoryIo()

    await createSampleCli(nodeParser, () => 0).run(['config', 'providers', 'ls', '-h'], io)

    expect(io.stdout.text()).toMatchInlineSnapshot(`
      "List providers

      Usage
        $ alint config providers ls [provider] [flags]

      Flags
        -c, --config <path>  Config file
            --no-cache       Disable the cache
        -l, --local          Use project scope
        -h, --help           Show help
        -v, --version        Show version
      "
    `)
  })

  it('notes defaults and repeatable flags in help', async () => {
    const io = createMemoryIo()

    await createSampleCli(nodeParser, () => 0).run(['lint', '--help'], io)

    expect(io.stdout.text()).toContain('  -f, --format <stylish|json>  Reporter (default: stylish)\n')
    expect(io.stdout.text()).toContain('      --rule <pattern...>      Rule filter (repeatable)\n')
  })

  it('returns the exit code of the command', async () => {
    const exitCode = await createSampleCli(nodeParser, () => 3).run(['src'], createMemoryIo())

    expect(exitCode).toBe(3)
  })

  it('reports usage errors thrown by a command', async () => {
    const io = createMemoryIo()
    const exitCode = await createSampleCli(nodeParser, () => {
      throw new UsageError('--dirty does not accept files')
    }).run(['src'], io)

    expect(exitCode).toBe(2)
    expect(io.stderr.text()).toBe('error: --dirty does not accept files\n\nRun `alint lint --help` for usage.\n')
  })

  it('rethrows other command errors', async () => {
    const cli = createSampleCli(nodeParser, () => {
      throw new Error('boom')
    })

    await expect(cli.run(['src'], createMemoryIo())).rejects.toThrow('boom')
  })

  it('passes the abort signal to the command', async () => {
    const run = vi.fn<Run>()
    const controller = new AbortController()

    await createSampleCli(nodeParser, run).run(['src'], createMemoryIo(), { signal: controller.signal })

    expect(run.mock.calls[0]?.[0].signal).toBe(controller.signal)
  })

  it('accepts undeclared flags when the command allows them', async () => {
    const run = vi.fn<Run>()
    const cli = createCli({
      action: run,
      allowUnknownFlags: true,
      arguments: '[...files]',
      description: 'Single command CLI',
      name: 'tool',
    })

    expect(await cli.run(['--extra', 'a'], createMemoryIo())).toBe(0)
    expect(run.mock.calls[0]?.[0].args).toEqual({ files: ['a'] })
  })
})

describe('createCli definition checks', () => {
  const leaf = (name: string, extra: object = {}) => defineCommand({ action: () => 0, description: name, name, ...extra })

  it.each([
    ['duplicate names', [leaf('a'), leaf('b', { alias: ['a'] })], 'more than one subcommand named "a"'],
    ['two defaults', [leaf('a', { default: true }), leaf('b', { default: true })], 'more than one default subcommand'],
    ['reserved short flag', [leaf('a', { flags: [{ description: '', flag: '-h, --hidden' }] })], 'reserved for help or version'],
    ['a shared set spread twice', [leaf('a', { flags: [...sharedFlags, ...sharedFlags] })], 'flag "-c, --config <path>" of command "a" clashes with flag "-c, --config <path>"'],
    ['both --cache and --no-cache', [leaf('a', { flags: [{ description: '', flag: '--cache' }, { description: '', flag: '--no-cache' }] })], 'clashes with flag "--cache"'],
    ['a malformed spelling', [leaf('a', { flags: [{ description: '', flag: '--config=<path>' }] })], 'is not a valid spelling'],
    ['a negated flag with a value', [leaf('a', { flags: [{ description: '', flag: '--no-cache <dir>' }] })], 'is negated, so it cannot take a value'],
    ['a bad argument pattern', [leaf('a', { arguments: '<a> files' })], 'Invalid argument "files"'],
    ['a leaf without an action', [defineCommand({ description: '', name: 'a' })], 'command "a" has neither an action nor children'],
  ])('rejects %s', (_, children, message) => {
    expect(() => createCli({ children, description: '', name: 'tool', version: '1.0.0' })).toThrow(DefinitionError)
    expect(() => createCli({ children, description: '', name: 'tool', version: '1.0.0' })).toThrow(message)
  })
})

describe('flag schemas', () => {
  it('passes the default through the schema', async () => {
    const run = vi.fn<Run>()
    const cli = createCli({
      action: run,
      description: '',
      flags: [{ default: '8080', description: 'Port', flag: '--port <port>', schema: v.pipe(v.string(), v.toNumber()) }],
      name: 'serve',
    })

    await cli.run([], createMemoryIo())

    expect(run.mock.calls[0]?.[0].flags).toEqual({ port: 8080 })
  })

  it('validates every value of a repeatable flag', async () => {
    const io = createMemoryIo()
    const cli = createCli({
      action: () => 0,
      description: '',
      flags: [{ description: 'Ports', flag: '--port <port...>', schema: v.array(v.pipe(v.string(), v.toNumber(), v.integer())) }],
      name: 'serve',
    })

    expect(await cli.run(['--port', '1', '--port', '2.5'], io)).toBe(2)
    expect(io.stderr.text().split('\n')[0]).toBe('error: flag --port: Invalid integer: Received 2.5')
  })
})
