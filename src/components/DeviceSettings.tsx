import { Locale, t } from '../i18n'

export type DeviceSettingsState = {
  volume: number
  locateLight: boolean
  wakeSensitivity: number
  ledDirection: boolean
}

type Props = {
  locale: Locale
  value: DeviceSettingsState
  onChange: (next: DeviceSettingsState) => void
  onApply: () => void
}

export function DeviceSettings({ locale, value, onChange, onApply }: Props) {
  return (
    <section className="card card-pad">
      <div className="card-head">
        <h2 className="section-title">{t(locale, 'settingsTitle')}</h2>
        <span className="chip subtle">{t(locale, 'placeholderHint')}</span>
      </div>

      <div className="settings-grid">
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
            {t(locale, 'wakeSensitivity')}
            <em>{value.wakeSensitivity}</em>
          </span>
          <input
            type="range"
            min={1}
            max={10}
            value={value.wakeSensitivity}
            onChange={(e) => onChange({ ...value, wakeSensitivity: Number(e.target.value) })}
          />
        </label>

        <div className="toggle-row">
          <span>{t(locale, 'locateLight')}</span>
          <button
            type="button"
            className={`toggle ${value.locateLight ? 'on' : ''}`}
            onClick={() => onChange({ ...value, locateLight: !value.locateLight })}
            aria-pressed={value.locateLight}
          >
            <i />
            {value.locateLight ? t(locale, 'on') : t(locale, 'off')}
          </button>
        </div>

        <div className="toggle-row">
          <span>{t(locale, 'ledDirection')}</span>
          <button
            type="button"
            className={`toggle ${value.ledDirection ? 'on' : ''}`}
            onClick={() => onChange({ ...value, ledDirection: !value.ledDirection })}
            aria-pressed={value.ledDirection}
          >
            <i />
            {value.ledDirection ? t(locale, 'on') : t(locale, 'off')}
          </button>
        </div>
      </div>

      <button type="button" className="btn btn-ghost block" onClick={onApply}>
        {t(locale, 'apply')}
      </button>
    </section>
  )
}
