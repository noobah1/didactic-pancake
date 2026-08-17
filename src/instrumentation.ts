// Next.js's supported "run once when the server boots" hook — starting the
// push checker here (rather than from a route handler module) means it
// can't accidentally get started twice by separate route imports.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startPushChecker } = await import('@/lib/push-checker')
    startPushChecker()
  }
}
