import { Locale, t } from '../i18n'

type Props = {
  locale: Locale
  current: string
  draft: string
  onDraft: (v: string) => void
  onAction: (action: 'query' | 'set' | 'restore') => void
  busy?: boolean
}

export function WakeWordPanel({ locale, current, draft, onDraft, onAction, busy }: Props) {
  return (
    <section className="card card-pad">
      <div className="card-head">
        <h2 className="section-title">{t(locale, 'wakeWordTitle')}</h2>
        <span className="chip subtle">{t(locale, 'wakeWordHint')}</span>
      </div>

      <p className="wake-current">
        {t(locale, 'wakeWordCurrent')}: <strong>{current || '—'}</strong>
      </p>

      <input
        className="text-input"
        value={draft}
        onChange={(e) => onDraft(e.target.value)}
        placeholder={t(locale, 'wakeWordInput')}
        disabled={busy}
      />

      <div className="btn-row">
        <button
          type="button"
          className="btn btn-ghost"
          disabled={busy}
          onClick={() => onAction('query')}
        >
          {t(locale, 'wakeQuery')}
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy}
          onClick={() => onAction('set')}
        >
          {t(locale, 'wakeSet')}
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={busy}
          onClick={() => onAction('restore')}
        >
          {t(locale, 'wakeRestore')}
        </button>
      </div>
    </section>
  )
}
