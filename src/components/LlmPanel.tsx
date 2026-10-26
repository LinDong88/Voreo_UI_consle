import { Locale, t } from '../i18n'
import { isLlmConfigured, LlmConfig } from '../llm'

type Props = {
  locale: Locale
  value: LlmConfig
  onChange: (next: LlmConfig) => void
  onSave: () => void
}

export function LlmPanel({ locale, value, onChange, onSave }: Props) {
  const ready = isLlmConfigured(value)

  return (
    <section className="card card-pad">
      <div className="card-head">
        <h2 className="section-title">{t(locale, 'llmTitle')}</h2>
        <span className={`chip ${ready ? 'ok' : 'subtle'}`}>
          {ready ? t(locale, 'llmReady') : t(locale, 'llmDemo')}
        </span>
      </div>

      <div className="settings-grid tight">
        <label className="field stack">
          <span>{t(locale, 'llmBaseUrl')}</span>
          <input
            className="text-input"
            value={value.baseUrl}
            onChange={(e) => onChange({ ...value, baseUrl: e.target.value })}
            placeholder="https://api.openai.com/v1"
          />
        </label>
        <label className="field stack">
          <span>{t(locale, 'llmApiKey')}</span>
          <input
            className="text-input"
            type="password"
            value={value.apiKey}
            onChange={(e) => onChange({ ...value, apiKey: e.target.value })}
            placeholder="sk-…"
            autoComplete="off"
          />
        </label>
        <label className="field stack">
          <span>{t(locale, 'llmModel')}</span>
          <input
            className="text-input"
            value={value.model}
            onChange={(e) => onChange({ ...value, model: e.target.value })}
            placeholder="gpt-4o-mini"
          />
        </label>

        <label className="check-row">
          <input
            type="checkbox"
            checked={value.autoReply}
            onChange={(e) => onChange({ ...value, autoReply: e.target.checked })}
          />
          <span>{t(locale, 'llmAuto')}</span>
        </label>
      </div>

      <button type="button" className="btn btn-primary block" onClick={onSave}>
        {t(locale, 'llmSave')}
      </button>
    </section>
  )
}
