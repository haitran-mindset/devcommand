import { setTimeout as delay } from 'node:timers/promises'

// This installed Playwright build treats a Promise-returning waitForFunction predicate
// as truthy before resolution. Poll IPC conditions in Node and await each evaluation.
export async function waitForIpc(page, predicate, arg, timeout = 15000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (await page.evaluate(predicate, arg)) return
    await delay(40)
  }
  throw new Error('Timed out waiting for an IPC state transition')
}
