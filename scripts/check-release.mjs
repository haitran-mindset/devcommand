import { readFileSync, appendFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export function validateRelease(tag, pkg, lock) {
  const version = pkg.version
  const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/
  const match = typeof version === 'string' && semver.exec(version)
  if (!match || match[4]?.split('.').some(part => /^\d+$/.test(part) && part.length > 1 && part.startsWith('0'))) {
    throw new Error('Package version must be a valid stable or prerelease SemVer (without build metadata).')
  }
  if (tag !== `v${version}`) throw new Error('Release tag must equal v + package.json version.')
  if (lock.version !== version || lock.packages?.['']?.version !== version) {
    throw new Error('package-lock.json versions must match package.json.')
  }
  return { version, prerelease: Boolean(match[4]) }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const result = validateRelease(process.argv[2] ?? process.env.GITHUB_REF_NAME,
      JSON.parse(readFileSync('package.json', 'utf8')),
      JSON.parse(readFileSync('package-lock.json', 'utf8')))
    if (process.env.GITHUB_OUTPUT) {
      appendFileSync(process.env.GITHUB_OUTPUT, `version=${result.version}\nprerelease=${result.prerelease}\n`)
    }
    process.stdout.write(`${JSON.stringify(result)}\n`)
  } catch (error) {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  }
}
