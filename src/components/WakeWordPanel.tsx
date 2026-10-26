import { Locale, t } from '../i18n'

type Props = {
  locale: Locale
  current: string
  draft: string
  onDraft: (v: string) => void
  onAction: (action: 'query' | 'set' | 'learn' | 'test' | 'restore') => void
}

export function WakeWordPanel({ locale, current, draft, onDraft, onAction }: Props) {
  return (
    <section className="card card-pad">
      <div className="card-head">
        <h2 className="section-title">{t(locale, 'wakeWordTitle')}</h2>
        <span className="chip subtle">{t(locale, 'placeholderHint')}</span>
      </div>

      <p className="wake-current">
        {t(locale, 'wakeWordCurrent')}: <strong>{current || '—'}</strong>
      </p>

      <input
        className="text-input"
        value={draft}
        onChange={(e) => onDraft(e.target.value)}
        placeholder={t(locale, 'wakeWordInput')}
      />

      <div className="btn-grid">
        <button type="button" className="btn btn-ghost" onClick={() => onAction('query')}>
          {t(locale, 'wakeQuery')}
        </button>
        <button type="button" className="btn btn-primary" onClick={() => onAction('set')}>
          {t(locale, 'wakeSet')}
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => onAction('learn')}>
          {t(locale, 'wakeLearn')}
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => onAction('test')}>
          {t(locale, 'wakeTest')}
        </button>
        <button type="button" className="btn btn-ghost wide" onClick={() => onAction('restore')}>
          {t(locale, 'wakeRestore')}
        </button>
      </div>
    </section>
  )
}
