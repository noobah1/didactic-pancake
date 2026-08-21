// Next.js's supported "run once when the server boots" hook.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startDetectorSampler } = await import('@/lib/traffic/sampler')
    startDetectorSampler()
  }
}
