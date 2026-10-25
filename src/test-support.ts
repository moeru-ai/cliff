import type { CliIo } from './io'

export interface TestIo extends CliIo {
  stderrText: () => string
  stdoutText: () => string
}

export function createTestIo(): TestIo {
  let stdout = ''
  let stderr = ''

  return {
    cwd: '/project',
    stderr: { write: (chunk: string) => (stderr += chunk) },
    stderrText: () => stderr,
    stdout: { write: (chunk: string) => (stdout += chunk) },
    stdoutText: () => stdout,
  }
}
