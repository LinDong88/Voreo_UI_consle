/** Host TTS packet size (leave margin under firmware 128B max) */
export const TTS_PACKET_MAX = 120
export const TTS_TOTAL_MAX = 2048

const encoder = new TextEncoder()

export function utf8ByteLength(text: string): number {
  return encoder.encode(text).length
}

/** Prefer cut after these when a packet nears the byte limit */
function isPunctChar(ch: string): boolean {
  return /[，。！？；、：,.!?;:\s…—\-《》〈〉「」『』""''（）()]/.test(ch)
}

/**
 * Split UTF-8 text into packets ≤ maxBytes.
 * Prefer punctuation/whitespace boundaries only when a packet hits the byte limit.
 */
export function splitTtsPackets(text: string, maxBytes = TTS_PACKET_MAX): string[] {
  const src = text.replace(/\r?\n/g, ' ').trim()
  if (!src) return []

  const packets: string[] = []
  let offset = 0

  while (offset < src.length) {
    let end = offset
    let bytes = 0
    let lastPunctEnd = -1

    while (end < src.length) {
      const ch = src[end]
      const chBytes = encoder.encode(ch).length
      if (bytes + chBytes > maxBytes) break
      bytes += chBytes
      end += 1
      if (isPunctChar(ch)) lastPunctEnd = end
    }

    if (end === offset) {
      // Single code point larger than max (shouldn't happen for normal text)
      packets.push(src[offset])
      offset += 1
      continue
    }

    // Only back up to punctuation when this packet filled to the byte limit
    const hitLimit = end < src.length
    if (hitLimit) {
      const minKeep = Math.max(1, Math.floor((end - offset) / 4))
      if (lastPunctEnd > offset + minKeep) {
        end = lastPunctEnd
      }
    }

    packets.push(src.slice(offset, end))
    offset = end
  }

  return packets
}
