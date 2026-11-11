import { Locale, t } from '../i18n'

export type DoaMode = 0 | 1 | 2

type Props = {
  locale: Locale
  angle: number | null
  energy: number | null
  doaMode: DoaMode | null
  onDoaModeChange: (mode: DoaMode) => void
  onRefresh: () => void
  busy?: boolean
}

export function DoaPanel({
  locale,
  angle,
  energy,
  doaMode,
  onDoaModeChange,
  onRefresh,
  busy,
}: Props) {
  const deg = angle ?? 0
  const active = angle != null
  const energyPct = energy == null ? 0 : Math.max(0, Math.min(100, (energy / 255) * 100))

  return (
    <section className="card card-pad doa-card">
      <div className="card-head">
        <h2 className="section-title">{t(locale, 'doaTitle')}</h2>
        <div className="doa-actions">
          <label className="doa-mode-field">
            <span className="sr-only">{t(locale, 'doaMode')}</span>
            <select
              className="text-input doa-mode-select"
              value={doaMode ?? ''}
              disabled={busy}
              onChange={(e) => {
                const v = Number(e.target.value)
                if (v === 0 || v === 1 || v === 2) onDoaModeChange(v)
              }}
            >
              <option value="" disabled>
                {t(locale, 'doaModePick')}
              </option>
              <option value={0}>{t(locale, 'doaModeOff')}</option>
              <option value={1}>{t(locale, 'doaModeOn')}</option>
              <option value={2}>{t(locale, 'doaModeListening')}</option>
            </select>
          </label>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={onRefresh}
            disabled={busy}
          >
            {t(locale, 'doaRefresh')}
          </button>
        </div>
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
          <div className="metric-row">
            <div className="metric">
              <span className="metric-label">{t(locale, 'angle')}</span>
              <strong className="metric-value">
                {angle == null ? '—' : `${Math.round(angle)}°`}
              </strong>
            </div>
            <div className="metric">
              <span className="metric-label">{t(locale, 'energy')}</span>
              <strong className="metric-value">
                {energy == null ? '—' : Math.round(energy)}
              </strong>
              <div className="meter" aria-hidden>
                <i style={{ width: `${energyPct}%` }} />
              </div>
            </div>
          </div>
          {!active && energy == null ? <p className="hint">{t(locale, 'doaWaiting')}</p> : null}
        </div>
      </div>
    </section>
  )
}
