import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { GitleaksIgnoreOption } from '../../../shared/extended'

const configDir = join(tmpdir(), 'devcommand-gitleaks')

const ignoreAllowlists: Record<Exclude<GitleaksIgnoreOption, 'none'>, string> = {
  readme: `[allowlist]
description = "Skip README.md"
paths = [
  '''(?i)readme\\.md$''',
]
`,
  tests: `[allowlist]
description = "Skip test files"
paths = [
  '''(?i)\\.(test|spec)\\.[a-zA-Z0-9]+$''',
  '''(?i)(^|/)tests?/''',
  '''(?i)(^|/)__tests__/''',
]
`,
  both: `[allowlist]
description = "Skip README.md and test files"
paths = [
  '''(?i)readme\\.md$''',
  '''(?i)\\.(test|spec)\\.[a-zA-Z0-9]+$''',
  '''(?i)(^|/)tests?/''',
  '''(?i)(^|/)__tests__/''',
]
`
}

export function buildGitleaksConfig(ignoreOption?: string, customRules?: string): string | undefined {
  const hasIgnore = ignoreOption && ignoreOption !== 'none' && ignoreOption in ignoreAllowlists
  const trimmedCustom = customRules?.trim()

  if (!hasIgnore && !trimmedCustom) return undefined

  const parts: string[] = []
  if (!trimmedCustom?.includes('[extend]')) {
    parts.push('[extend]\nuseDefault = true\n')
  }

  if (hasIgnore) {
    parts.push(ignoreAllowlists[ignoreOption as Exclude<GitleaksIgnoreOption, 'none'>])
  }

  if (trimmedCustom) {
    parts.push(trimmedCustom)
  }

  return parts.join('\n')
}

export function ensureGitleaksConfig(ignoreOption?: string, customRules?: string): string | undefined {
  const content = buildGitleaksConfig(ignoreOption, customRules)
  if (!content) return undefined

  mkdirSync(configDir, { recursive: true })
  const hash = createHash('sha256').update(content).digest('hex').slice(0, 12)
  const filename = customRules?.trim()
    ? `custom-${hash}.toml`
    : `ignore-${ignoreOption}.toml`
  const target = join(configDir, filename)
  writeFileSync(target, content, 'utf8')
  return target
}

export function gitleaksArguments(baseArgs: string[], ignoreOption?: string, customRules?: string): string[] {
  const config = ensureGitleaksConfig(ignoreOption, customRules)
  if (!config) return baseArgs
  const result = [...baseArgs]
  const lastIndex = result.lastIndexOf('.')
  if (lastIndex !== -1) {
    result.splice(lastIndex, 0, '--config', config)
  } else {
    result.push('--config', config)
  }
  return result
}
