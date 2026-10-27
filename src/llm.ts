export type LlmConfig = {
  baseUrl: string
  apiKey: string
  model: string
  enabled: boolean
  autoReply: boolean
  /** When LLM is not configured, use fixed demo replies only if this is on. */
  useDemoReply: boolean
}

export const defaultLlmConfig = (): LlmConfig => ({
  baseUrl: '',
  apiKey: '',
  model: '',
  enabled: false,
  autoReply: true,
  useDemoReply: false,
})

export function loadLlmConfig(): LlmConfig {
  try {
    const raw = localStorage.getItem('voreo-llm')
    if (!raw) return defaultLlmConfig()
    return { ...defaultLlmConfig(), ...JSON.parse(raw) }
  } catch {
    return defaultLlmConfig()
  }
}

export function saveLlmConfig(cfg: LlmConfig) {
  localStorage.setItem('voreo-llm', JSON.stringify(cfg))
}

export function isLlmConfigured(cfg: LlmConfig) {
  return Boolean(cfg.baseUrl.trim() && cfg.apiKey.trim() && cfg.model.trim())
}

const DEMO_ZH = [
  '好的，我在听。',
  '收到，稍等一下。',
  '可以的，还有别的需要吗？',
  '明白了，我会继续为你服务。',
  '这个问题我记下了。',
]

const DEMO_EN = [
  'Okay, I am listening.',
  'Got it — one moment.',
  'Sure. Anything else?',
  'Understood. Happy to help.',
  'Noted. I will keep that in mind.',
]

export function demoReply(locale: 'zh' | 'en', asrText: string): string {
  const pool = locale === 'zh' ? DEMO_ZH : DEMO_EN
  const idx = Math.abs(hash(asrText)) % pool.length
  if (locale === 'zh') {
    return `${pool[idx]}（演示回复）`
  }
  return `${pool[idx]} (demo reply)`
}

function hash(s: string) {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return h
}

export async function askLlm(
  cfg: LlmConfig,
  userText: string,
  signal?: AbortSignal,
): Promise<string> {
  const base = cfg.baseUrl.replace(/\/+$/, '')
  const url = /\/chat\/completions$/i.test(base)
    ? base
    : `${base}/chat/completions`

  const res = await fetch(url, {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({
      model: cfg.model,
      temperature: 0.6,
      messages: [
        {
          role: 'system',
          content:
            'You are Voreo, a concise voice assistant. Reply in the same language as the user. Keep answers under 80 words, spoken style, no markdown.',
        },
        { role: 'user', content: userText },
      ],
    }),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`LLM ${res.status}: ${body.slice(0, 180) || res.statusText}`)
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }
  const text = data.choices?.[0]?.message?.content?.trim()
  if (!text) throw new Error('LLM empty response')
  return text
}
