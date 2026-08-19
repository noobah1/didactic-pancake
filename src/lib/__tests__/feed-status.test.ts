import { resolveFeedStatus } from '../feed-status'

describe('resolveFeedStatus', () => {
  it('is loading before the first fetch resolves', () => {
    expect(resolveFeedStatus(null, null)).toBe('loading')
  })

  it('is live once data arrives with no availability field and no error', () => {
    expect(resolveFeedStatus({}, null)).toBe('live')
  })

  it('passes through the server-reported availability when there is no transport error', () => {
    expect(resolveFeedStatus({ availability: 'partial' }, null)).toBe('partial')
    expect(resolveFeedStatus({ availability: 'stale' }, null)).toBe('stale')
    expect(resolveFeedStatus({ availability: 'unavailable' }, null)).toBe('unavailable')
  })

  it('falls back to stale when a poll fails but prior data is still held', () => {
    expect(resolveFeedStatus({ availability: 'live' }, new Error('network'))).toBe('stale')
  })

  it('is unavailable when a poll fails and there is no prior data at all', () => {
    expect(resolveFeedStatus(null, new Error('network'))).toBe('unavailable')
  })
})
