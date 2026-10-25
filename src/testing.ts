import type { CliIo, CliWritable } from './io'

export interface MemoryIo extends CliIo {
  stderr: MemoryWritable
  stdout: MemoryWritable
}

export interface MemoryWritable extends CliWritable {
  /** Everything written so far. */
  text: () => string
}

/**
 * In-memory I/O for running a CLI inside a test:
 *
 * ```ts
 * const io = createMemoryIo()
 * expect(await cli.run(['lint', 'src'], io)).toBe(0)
 * expect(io.stdout.text()).toContain('src')
 * ```
 *
 * `overrides` sets the pass-through fields (`cwd`, `env`, `stdin`) or replaces a stream.
 */
export function createMemoryIo(overrides: Partial<CliIo> = {}): MemoryIo {
  return {
    ...overrides,
    stderr: createMemoryWritable(overrides.stderr),
    stdout: createMemoryWritable(overrides.stdout),
  }
}

function createMemoryWritable(base: CliWritable | undefined): MemoryWritable {
  let text = ''

  return {
    columns: base?.columns,
    isTTY: base?.isTTY,
    rows: base?.rows,
    text: () => text,
    write: (chunk: string) => {
      text += chunk
      base?.write(chunk)
    },
  }
}
