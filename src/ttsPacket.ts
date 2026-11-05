/**
 * 主机按 ≤512B 切包喂入；固件 4KB 池 + +TTS:Q / PAUSE 流控，再按更小帧切给模组。
 * 输入全文长度不限制。
 */
export const TTS_FW_BUF_MAX = 4096
/** 单次 AT+TTS 载荷上限 */
export const TTS_PACKET_MAX = 512

const encoder = new TextEncoder()

export function utf8ByteLength(text: string): number {
  return encoder.encode(text).length
}

/**
 * 按 UTF-8 字节硬切成 ≤ maxBytes 的块（避开半个多字节字符）。
 */
export function splitForAtLine(text: string, maxBytes = TTS_PACKET_MAX): string[] {
  const src = text.replace(/\r?\n/g, ' ').trim()
  if (!src) return []
  if (utf8ByteLength(src) <= maxBytes) return [src]

  const bytes = encoder.encode(src)
  const chunks: string[] = []
  const decoder = new TextDecoder()
  let i = 0
  while (i < bytes.length) {
    let end = Math.min(i + maxBytes, bytes.length)
    if (end < bytes.length) {
      while (end > i && (bytes[end] & 0xc0) === 0x80) end--
      if (end === i) end = Math.min(i + maxBytes, bytes.length)
    }
    chunks.push(decoder.decode(bytes.subarray(i, end)))
    i = end
  }
  return chunks
}
