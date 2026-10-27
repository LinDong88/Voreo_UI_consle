import { Locale, t } from '../i18n'

export type DeviceSettingsState = {
  volume: number
  speed: number
}

type Props = {
  locale: Locale
  value: DeviceSettingsState
  onChange: (next: DeviceSettingsState) => void
  onApply: () => void
  busy?: boolean
}

export function DeviceSettings({ locale, value, onChange, onApply, busy }: Props) {
  return (
    <section className="card card-pad">
      <div className="card-head">
        <h2 className="section-title">{t(locale, 'settingsTitle')}</h2>
      </div>

      <div className="settings-grid tight">
        <label className="field">
          <span>
            {t(locale, 'volume')}
            <em>{value.volume}</em>
          </span>
          <input
            type="range"
            min={0}
            max={15}
            value={value.volume}
            onChange={(e) => onChange({ ...value, volume: Number(e.target.value) })}
          />
        </label>

        <label className="field">
          <span>
            {t(locale, 'speed')}
            <em>{value.speed}</em>
          </span>
          <input
            type="range"
            min={0}
            max={15}
            value={value.speed}
            onChange={(e) => onChange({ ...value, speed: Number(e.target.value) })}
          />
        </label>
      </div>

      <button type="button" className="btn btn-primary block" onClick={onApply} disabled={busy}>
        {t(locale, 'apply')}
      </button>
    </section>
  )
}
