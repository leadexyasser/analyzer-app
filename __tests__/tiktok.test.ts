import { describe, it, expect } from 'vitest'
import { dateChunks, parseAccountDays, parseAdDays } from '../lib/tiktok'

describe('dateChunks', () => {
  it('returns a single chunk when the range fits', () => {
    expect(dateChunks('2026-11-19', '2026-11-24', 30)).toEqual([
      { since: '2026-11-19', until: '2026-11-24' },
    ])
  })

  it('splits a long range into windows no longer than the limit', () => {
    const chunks = dateChunks('2026-10-01', '2026-11-24', 30)
    expect(chunks).toEqual([
      { since: '2026-10-01', until: '2026-10-30' },
      { since: '2026-10-31', until: '2026-11-24' },
    ])
  })

  it('returns nothing when since is after until', () => {
    expect(dateChunks('2026-11-24', '2026-11-19', 30)).toEqual([])
  })
})

describe('parseAccountDays', () => {
  it('maps report rows to daily totals with plain dates', () => {
    const rows = [
      {
        dimensions: { advertiser_id: '761', stat_time_day: '2026-11-23 00:00:00' },
        metrics: { spend: '699.25', impressions: '30128', clicks: '624', conversion: '39' },
      },
    ]
    expect(parseAccountDays(rows, '761')).toEqual([
      { stat_date: '2026-11-23', advertiser_id: '761', spend: 699.25, impressions: 30128, clicks: 624, conversions: 39 },
    ])
  })

  it('keeps zero days so a quiet weekend overwrites any stale figure', () => {
    const rows = [
      {
        dimensions: { stat_time_day: '2026-11-22 00:00:00' },
        metrics: { spend: '0.00', impressions: '0', clicks: '0', conversion: '0' },
      },
    ]
    expect(parseAccountDays(rows, '761')[0].spend).toBe(0)
  })

  it('treats missing or non-numeric metrics as zero', () => {
    const rows = [{ dimensions: { stat_time_day: '2026-11-20 00:00:00' }, metrics: { spend: '-' } }]
    expect(parseAccountDays(rows, '761')[0]).toMatchObject({ spend: 0, impressions: 0, clicks: 0, conversions: 0 })
  })

  it('drops rows without a date rather than inventing one', () => {
    expect(parseAccountDays([{ dimensions: {}, metrics: { spend: '5' } }], '761')).toEqual([])
  })
})

describe('parseAdDays', () => {
  const row = (spend: string, impressions: string, conversion = '0') => ({
    dimensions: { ad_id: '188', stat_time_day: '2026-11-23 00:00:00' },
    metrics: {
      ad_name: 'YSI-THIS IS JUST.mp4_THIS IS JUST | NW',
      adgroup_name: 'THIS IS JUST | NW',
      campaign_name: 'ALL NEW CAMPS',
      spend, impressions, clicks: '10', conversion,
    },
  })

  it('maps names and metrics for an ad that delivered', () => {
    expect(parseAdDays([row('125.24', '5000', '9')], '761')).toEqual([{
      stat_date: '2026-11-23',
      advertiser_id: '761',
      ad_id: '188',
      ad_name: 'YSI-THIS IS JUST.mp4_THIS IS JUST | NW',
      adgroup_name: 'THIS IS JUST | NW',
      campaign_name: 'ALL NEW CAMPS',
      spend: 125.24,
      impressions: 5000,
      clicks: 10,
      conversions: 9,
    }])
  })

  it('skips ad-days with no delivery at all', () => {
    expect(parseAdDays([row('0.00', '0')], '761')).toEqual([])
  })

  it('skips rows without an ad id or date', () => {
    expect(parseAdDays([{ dimensions: { stat_time_day: '2026-11-23 00:00:00' }, metrics: { spend: '5' } }], '761')).toEqual([])
  })
})
