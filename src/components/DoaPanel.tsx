import { Locale, t } from '../i18n'

type Props = {
  locale: Locale
  angle: number | null
  confidence: number | null
}

export function DoaPanel({ locale, angle, confidence }: Props) {
  const deg = angle ?? 0
  const confPct = confidence == null ? null : Math.round(Math.min(1, Math.max(0, confidence)) * 100)
  const active = angle != null

  return (
    <section className="card card-pad doa-card">
      <div className="card-head">
        <h2 className="section-title">{t(locale, 'doaTitle')}</h2>
        <span className="chip subtle">{t(locale, 'placeholderHint')}</span>
      </div>

      <div className="doa-body">
        <div className={`doa-compass ${active ? 'live' : ''}`} aria-hidden>
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
          <div className="metric">
            <span className="metric-label">{t(locale, 'confidence')}</span>
            <strong className="metric-value">{confPct == null ? '—' : `${confPct}%`}</strong>
            <div className="meter">
              <i style={{ width: `${confPct ?? 0}%` }} />
            </div>
          </div>
          {!active ? <p className="hint">{t(locale, 'doaWaiting')}</p> : null}
        </div>
      </div>
    </section>
  )
}
