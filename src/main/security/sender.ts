interface SenderContext {
  senderId: number
  expectedId: number
  frameUrl: string | undefined
  isMainFrame: boolean
  rendererUrl: string
}
export function assertTrustedSender(context: SenderContext): void {
  if (context.senderId !== context.expectedId || !context.isMainFrame || !context.frameUrl) {
    throw new Error('Unauthorized IPC sender')
  }
  const actual = new URL(context.frameUrl)
  const expected = new URL(context.rendererUrl)
  actual.hash = ''
  expected.hash = ''
  if (actual.href !== expected.href) throw new Error('Unauthorized IPC origin')
}
