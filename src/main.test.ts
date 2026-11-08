import process from 'node:process'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createCli } from './cli'

type Listener = (signal: NodeJS.Signals) => void

describe('cli.run', () => {
  const listeners = new Map<string, Listener>()
  let exitCode: typeof process.exitCode

  beforeEach(() => {
    exitCode = process.exitCode
    listeners.clear()
    // Capture the handlers instead of registering them, so the test can deliver a signal
    // without the worker receiving a real SIGINT.
    vi.spyOn(process, 'once').mockImplementation(((event: string, listener: Listener) => {
      listeners.set(event, listener)
      return process
    }) as typeof process.once)
    vi.spyOn(process, 'off').mockImplementation(((event: string) => {
      listeners.delete(event)
      return process
    }) as typeof process.off)
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  })

  afterEach(() => {
    process.exitCode = exitCode
    vi.restoreAllMocks()
  })

  function createWaitingCli() {
    return createCli({
      action: ({ signal }) => new Promise((_, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason))
      }),
      description: '',
      name: 'tool',
    })
  }

  it('aborts the command on SIGINT and exits with 128 + the signal number', async () => {
    const running = createWaitingCli().run({ argv: [] })

    await vi.waitFor(() => expect(listeners.has('SIGINT')).toBe(true))
    listeners.get('SIGINT')!('SIGINT')
    await running

    expect(process.exitCode).toBe(130)
    expect(process.stderr.write).not.toHaveBeenCalled()
    expect(listeners.size).toBe(0)
  })

  it('aborts the command when the caller signal aborts', async () => {
    const controller = new AbortController()
    const running = createWaitingCli().run({ argv: [], signal: controller.signal })

    await vi.waitFor(() => expect(listeners.has('SIGINT')).toBe(true))
    controller.abort(new Error('timed out'))
    await running

    expect(process.exitCode).toBe(1)
    expect(process.stderr.write).toHaveBeenCalledWith('tool: timed out\n')
  })
})
