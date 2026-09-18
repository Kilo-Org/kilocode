import { type ComponentProps, type JSX, splitProps } from "solid-js"

export interface KiloPassMeterProps extends Omit<ComponentProps<"div">, "children"> {
  used: number
  paid: number
  bonus: number
  label: JSX.Element
  paidLabel: JSX.Element
  bonusLabel: JSX.Element
  format: (value: number) => string
}

export function KiloPassMeter(props: KiloPassMeterProps) {
  const [local, rest] = splitProps(props, [
    "used",
    "paid",
    "bonus",
    "label",
    "paidLabel",
    "bonusLabel",
    "format",
    "class",
    "classList",
  ])
  const model = () => {
    const paid = Math.max(0, local.paid)
    const bonus = Math.max(0, local.bonus)
    const used = Math.max(0, local.used)
    const total = paid + bonus
    // With no credits at all the track stays empty instead of rendering a
    // full-width paid allocation for a $0 pass.
    const boundary = total > 0 ? (paid / total) * 100 : 0
    const filled = total > 0 ? Math.min(100, (used / total) * 100) : 0
    return {
      paid,
      bonus,
      used,
      total,
      boundary,
      paidFill: Math.min(filled, boundary),
      bonusFill: Math.max(0, filled - boundary),
    }
  }

  return (
    <div
      {...rest}
      data-component="kilo-pass-meter"
      role="meter"
      aria-valuemin={0}
      aria-valuemax={Math.max(model().total, 1)}
      aria-valuenow={Math.min(model().used, Math.max(model().total, 1))}
      aria-valuetext={`${local.format(model().used)} / ${local.format(model().total)}`}
      classList={{ ...local.classList, [local.class ?? ""]: !!local.class }}
    >
      <div data-slot="kilo-pass-meter-header">
        <span>{local.label}</span>
        <strong>
          {local.format(model().used)} / {local.format(model().total)}
        </strong>
      </div>
      <div data-slot="kilo-pass-meter-track" aria-hidden="true">
        <div data-slot="kilo-pass-meter-paid-background" style={{ width: `${model().boundary}%` }} />
        <div
          data-slot="kilo-pass-meter-bonus-background"
          hidden={model().bonus <= 0}
          style={{ left: `${model().boundary}%`, width: `${100 - model().boundary}%` }}
        />
        <div data-slot="kilo-pass-meter-paid-fill" style={{ width: `${model().paidFill}%` }} />
        <div
          data-slot="kilo-pass-meter-bonus-fill"
          hidden={model().bonusFill <= 0}
          style={{ left: `${model().boundary}%`, width: `${model().bonusFill}%` }}
        />
        <div
          data-slot="kilo-pass-meter-boundary"
          hidden={model().bonus <= 0}
          style={{ left: `${model().boundary}%` }}
        />
      </div>
      <div data-slot="kilo-pass-meter-amounts" aria-hidden="true">
        <span
          hidden={model().total <= 0}
          data-pin={model().bonus <= 0 ? "end" : model().paid <= 0 ? "start" : undefined}
          style={{ left: `${model().boundary}%` }}
        >
          {local.format(model().paid)}
        </span>
        <span data-slot="kilo-pass-meter-bonus-amount" hidden={model().bonus <= 0}>
          {local.format(model().bonus)}
        </span>
      </div>
      <div data-slot="kilo-pass-meter-legend">
        <span>
          <i data-slot="kilo-pass-meter-paid-dot" aria-hidden="true" />
          {local.paidLabel}
        </span>
        <span hidden={model().bonus <= 0}>
          <i data-slot="kilo-pass-meter-bonus-dot" aria-hidden="true" />
          {local.bonusLabel}
        </span>
      </div>
    </div>
  )
}
