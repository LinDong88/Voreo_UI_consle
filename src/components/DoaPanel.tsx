import { Locale, t } from '../i18n'

type Props = {
  locale: Locale
  angle: number | null
  onRefresh: () => void
  polling: boolean
  onTogglePoll: () => void
  busy?: boolean
}

export function DoaPanel({ locale, angle, onRefresh, polling, onTogglePoll, busy }: Props) {
  const deg = angle ?? 0
  const active = angle != null

  return (
    <section className="card card-pad doa-card">
      <div className="card-head">
        <h2 className="section-title">{t(locale, 'doaTitle')}</h2>
        <div className="doa-actions">
          <button
            type="button"
            className={`btn btn-sm ${polling ? 'btn-primary' : 'btn-ghost'}`}
            onClick={onTogglePoll}
            aria-pressed={polling}
          >
            {polling ? t(locale, 'doaPollOff') : t(locale, 'doaPollOn')}
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={onRefresh}
            disabled={busy || polling}
          >
            {t(locale, 'doaRefresh')}
          </button>
        </div>
      </div>

      <div className="doa-body">
        <div className={`doa-compass ${active ? 'live' : ''} ${polling ? 'polling' : ''}`} aria-hidden>
          <div className="doa-ring" />
          <div className="doa-tick n">0°</div>
          <div className="doa-tick e">90°</div>
          <div className="doa-tick s">180°</div>
          <div className="doa-tick w">270°</div>
          <div className="doa-needle" style={{ transform: `rotate(${deg}deg)` }}>
            <span />
          </div>
          <div className="doa-hub" />
        </div>

        <div className="doa-metrics">
          <div className="metric">
            <span className="metric-label">{t(locale, 'angle')}</span>
            <strong className="metric-value">{angle == null ? '—' : `${Math.round(angle)}°`}</strong>
          </div>
          {!active ? <p className="hint">{t(locale, 'doaWaiting')}</p> : null}
          {polling ? <p className="hint">{t(locale, 'doaPollOn')}</p> : null}
        </div>
      </div>
    </section>
  )
}
