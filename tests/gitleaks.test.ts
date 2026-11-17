import { describe, expect, it } from 'vitest'
import { ensureGitleaksConfig, gitleaksArguments } from '../src/main/services/commands/gitleaks'
import { existsSync, readFileSync } from 'node:fs'

describe('gitleaks command helper', () => {
  it('returns original args when ignore is none or undefined', () => {
    const base = ['git', '--staged', '--no-banner', '.']
    expect(gitleaksArguments(base, 'none')).toEqual(base)
    expect(gitleaksArguments(base, undefined)).toEqual(base)
    expect(gitleaksArguments(base, 'unknown')).toEqual(base)
  })

  it('inserts --config before trailing dot for readme ignore', () => {
    const base = ['git', '--staged', '--no-banner', '.']
    const result = gitleaksArguments(base, 'readme')
    expect(result).toHaveLength(6)
    expect(result[result.length - 1]).toBe('.')
    expect(result[result.length - 3]).toBe('--config')
    const configPath = result[result.length - 2]
    expect(existsSync(configPath)).toBe(true)
    const content = readFileSync(configPath, 'utf8')
    expect(content).toContain('readme\\.md')
  })

  it('generates test ignore config correctly', () => {
    const configPath = ensureGitleaksConfig('tests')!
    expect(existsSync(configPath)).toBe(true)
    const content = readFileSync(configPath, 'utf8')
    expect(content).toContain('test|spec')
    expect(content).toContain('tests?/')
  })

  it('generates combined readme and tests ignore config correctly', () => {
    const configPath = ensureGitleaksConfig('both')!
    expect(existsSync(configPath)).toBe(true)
    const content = readFileSync(configPath, 'utf8')
    expect(content).toContain('readme\\.md')
    expect(content).toContain('test|spec')
  })

  it('generates custom rules config with [extend] and user content', () => {
    const custom = `[[rules]]\nid = "internal-token"\nregex = '''INTERNAL_[0-9]+'''`
    const configPath = ensureGitleaksConfig('none', custom)!
    expect(existsSync(configPath)).toBe(true)
    const content = readFileSync(configPath, 'utf8')
    expect(content).toContain('[extend]')
    expect(content).toContain('internal-token')
  })

  it('combines ignore option and custom rules into one config', () => {
    const custom = `[[rules]]\nid = "custom"\nregex = '''SECRET_[0-9]+'''`
    const base = ['git', '--no-banner', '.']
    const result = gitleaksArguments(base, 'readme', custom)
    expect(result).toHaveLength(5)
    expect(result[result.length - 3]).toBe('--config')
    const configPath = result[result.length - 2]
    const content = readFileSync(configPath, 'utf8')
    expect(content).toContain('readme\\.md')
    expect(content).toContain('SECRET_[0-9]+')
  })
})
