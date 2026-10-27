/** Align with firmware VOREO_TTS_PAYLOAD_MAX / host policy */
export const TTS_PACKET_MAX = 128
export const TTS_TOTAL_MAX = 2048

const encoder = new TextEncoder()

export function utf8ByteLength(text: string): number {
  return encoder.encode(text).length
}

function isPunctChar(ch: string): boolean {
  return /[，。！？；、,.!?;:\s…—\-]/.test(ch)
}

/**
 * Split UTF-8 text into packets ≤ maxBytes, preferring punctuation boundaries.
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

    const minKeep = Math.max(1, Math.floor((end - offset) / 4))
    if (lastPunctEnd > offset + minKeep && lastPunctEnd < src.length) {
      end = lastPunctEnd
    }

    packets.push(src.slice(offset, end))
    offset = end
  }

  return packets
}
