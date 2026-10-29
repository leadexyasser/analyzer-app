// Works out WHO actually closed a call, for the Telegram title prefix ("I.S.M | ...").
// The Ringba buyer is only the router when calls go through a marketplace like RingbaX —
// the real closer is named on the recording, so we look for it in the transcript.

export type ClosingBuyer = {
  code: string        // short title prefix, e.g. "I.S.M"
  name: string        // readable name, e.g. "Insurance Supermarket"
  via: string | null  // marketplace it came through, e.g. "RingbaX"; null when direct
}

type KnownBuyer = { code: string; name: string; pattern: RegExp }

// Order matters: first match wins. EMC National is the carrier Insurance Supermarket
// writes on these calls (HIPAA authorization), so it identifies I.S.M too.
const KNOWN_BUYERS: readonly KnownBuyer[] = [
  { code: 'I.S.M', name: 'Insurance Supermarket', pattern: /insurance supermarket|emc national/i },
  { code: 'SEC.NAT', name: 'Security National', pattern: /security national/i },
  { code: 'SR.LIFE', name: 'Senior Life', pattern: /senior life/i },
  { code: 'AM.AMIC', name: 'American Amicable', pattern: /american amicable/i },
]

const MARKETPLACES: readonly string[] = ['ringbax']

// "(ADV) WCMD (380)" → "WCMD"; "Insurance Supermarket Inc (559)" → "Insurance Supermarket Inc"
function cleanBuyerName(raw: string): string {
  return raw.replace(/\((?:ADV|NET)\)/gi, '').replace(/\(\d+\)/g, '').replace(/\s+/g, ' ').trim()
}

export function resolveClosingBuyer(
  buyerName: string | null | undefined,
  transcript: string | null | undefined
): ClosingBuyer {
  const routed = cleanBuyerName(buyerName ?? '')
  const isMarketplace = MARKETPLACES.some(m => routed.toLowerCase().includes(m))
  const via = isMarketplace ? routed : null

  // Direct buyer that is itself a known closer (e.g. the I.S.M target).
  const direct = KNOWN_BUYERS.find(b => b.pattern.test(routed))
  if (direct && !isMarketplace) return { code: direct.code, name: direct.name, via: null }

  // Marketplace calls are always titled by the marketplace (e.g. "RINGBAX | ..."), even when
  // I.S.M closed them behind it — the closer is still named in the buyer line.
  const spoken = KNOWN_BUYERS.find(b => b.pattern.test(transcript ?? ''))
  if (isMarketplace) {
    return spoken
      ? { code: routed.toUpperCase(), name: spoken.name, via }
      : { code: routed.toUpperCase(), name: routed, via: null }
  }
  if (spoken) return { code: spoken.code, name: spoken.name, via: null }

  if (routed) return { code: routed.toUpperCase(), name: routed, via: null }
  return { code: 'UNKNOWN', name: 'Unknown buyer', via: null }
}
