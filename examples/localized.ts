import type { Help, HelpFlag, UsageIssue } from '@moeru/cliff'

import { createCli, defineCommand, formatRows } from '@moeru/cliff'

// Command and flag descriptions are your own strings, so they are written in Chinese directly.
// Everything cliff itself would word in English goes through the two hooks below.
const serve = defineCommand({
  action: ({ args, flags, io }) => {
    io.stdout.write(`在 ${args.port} 端口提供 ${args.dir}（日志级别：${flags.log}）\n`)
  },
  alias: ['s'],
  arguments: [
    { description: '监听的端口', name: 'port', required: true },
    { default: '.', description: '要提供的目录', name: 'dir' },
  ],
  description: '启动开发服务器',
  examples: ['tool-zh serve 8080', 'tool-zh serve 8080 dist --log debug'],
  flags: [
    { default: 'info', description: '日志级别', flag: '-l, --log <debug|info|warn>' },
    { description: '额外的响应头', flag: '--header <value...>' },
  ],
  name: 'serve',
})

const builtins = { help: '显示帮助', version: '显示版本' }

function describeFlag(flag: HelpFlag): string {
  if (flag.builtin !== undefined) {
    return builtins[flag.builtin]
  }

  const notes = [
    ...(flag.repeatable ? ['可重复'] : []),
    ...(flag.default === undefined ? [] : [`默认：${String(flag.default)}`]),
  ]

  return notes.length > 0 ? `${flag.description}（${notes.join('，')}）` : flag.description
}

function describeIssue(issue: UsageIssue): string {
  switch (issue.code) {
    case 'flag-requires-value':
      return `选项 ${issue.flag} 需要一个值`
    case 'invalid-choice':
      return `选项 ${issue.flag} 只能是 ${issue.choices.join('、')} 之一，收到了“${issue.received}”`
    case 'invalid-value':
      // The messages come from the schema, so translate them there (Valibot, Zod, and ArkType all can).
      return `${issue.target === 'flag' ? '选项' : '参数'} ${issue.label} 无效：${issue.messages.join('；')}`
    case 'missing-argument':
      return `缺少必填参数 ${issue.argument}`
    case 'missing-command':
      return `“${issue.command}”需要一个子命令`
    case 'unexpected-argument':
      return `多余的参数“${issue.received}”`
    case 'unknown-command':
      return `“${issue.command}”没有子命令“${issue.received}”`
    case 'unknown-flag':
      return `未知的选项 ${issue.flag}`
  }
}

function renderHelp(help: Help): string {
  const sections = [
    help.help ?? help.description,
    `用法\n${help.usage.map(line => `  $ ${line}`).join('\n')}`,
  ]

  if (help.arguments.length > 0) {
    sections.push(`参数\n${formatRows(help.arguments.map(argument => ({
      description: argument.default === undefined ? argument.description : `${argument.description}（默认：${String(argument.default)}）`,
      label: argument.label,
    })))}`)
  }

  if (help.commands.length > 0) {
    sections.push(`命令\n${formatRows(help.commands.map(command => ({
      description: command.default ? `${command.description}（默认）` : command.description,
      label: [[command.name, ...command.aliases].join(', '), command.hasChildren ? '<command>' : command.argumentsLabel].filter(Boolean).join(' '),
    })))}`)
  }

  sections.push(`选项\n${formatRows(help.flags.map(flag => ({
    description: describeFlag(flag),
    label: flag.short === undefined ? `    ${flag.label}` : flag.label,
  })))}`)

  if (help.examples.length > 0) {
    sections.push(`示例\n${help.examples.map(example => `  ${example}`).join('\n')}`)
  }

  return `${sections.join('\n\n')}\n`
}

export const cli = createCli({
  children: [serve],
  description: '一个中文界面的示例工具。',
  name: 'tool-zh',
  renderHelp,
  renderUsageError: (report) => {
    // An action may throw a `UsageError` without an issue; its message is all there is.
    const message = report.issue ? describeIssue(report.issue) : report.message
    const commands = report.commands
      ? `\n\n可用的命令\n${formatRows(report.commands.map(command => ({ description: command.description, label: command.name })))}`
      : ''

    return `错误：${message}${commands}\n\n运行 \`${report.command} --help\` 查看用法。\n`
  },
  version: '1.0.0',
})
