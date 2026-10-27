import { Locale } from '../i18n'
import { deviceStateMeta, DeviceStateName } from '../deviceState'

type Props = {
  locale: Locale
  state: DeviceStateName | null
  onRefresh?: () => void
  busy?: boolean
}

export function DeviceStateIcon({ locale, state, onRefresh, busy }: Props) {
  const meta = deviceStateMeta(state)
  const label = locale === 'zh' ? meta.zh : meta.en

  return (
    <button
      type="button"
      className={`device-state device-state--${meta.tone}`}
      title={`${state ?? '—'} · ${label}`}
      aria-label={label}
      disabled={busy || !onRefresh}
      onClick={onRefresh}
    >
      <span className="device-state-led" aria-hidden />
      <span className="device-state-text">
        <strong>{state ?? '—'}</strong>
        <em>{label}</em>
      </span>
    </button>
  )
}
