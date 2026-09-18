/** @jsxImportSource solid-js */
import type { Meta, StoryObj } from "storybook-solidjs-vite"
import { KiloPassMeter } from "../components/kilo-pass-meter"

const meta: Meta<typeof KiloPassMeter> = {
  title: "Components/Kilo Pass Meter",
  component: KiloPassMeter,
  decorators: [
    (Story) => (
      <div style={{ padding: "16px", width: "320px" }}>
        <Story />
      </div>
    ),
  ],
  parameters: { layout: "centered" },
}

export default meta
type Story = StoryObj<typeof KiloPassMeter>

const format = (value: number) => `$${value.toFixed(2)}`
const render = (used: number, paid: number, bonus: number) => (
  <KiloPassMeter
    used={used}
    paid={paid}
    bonus={bonus}
    label="This month's usage"
    paidLabel="Paid"
    bonusLabel="Bonus"
    format={format}
    aria-label="Kilo Pass monthly usage"
  />
)

export const CurrentPlan: Story = { render: () => render(73.27, 199, 99.5) }
export const UsingBonus: Story = { render: () => render(240, 199, 99.5) }
export const PaidOnly: Story = { render: () => render(73.27, 199, 0) }
export const Empty: Story = { render: () => render(0, 0, 0) }
export const OverLimit: Story = { render: () => render(325, 199, 99.5) }
