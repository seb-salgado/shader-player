"use client"

import { SliderComfortable } from "@/components/ui/slider"

interface ParameterSliderProps {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (value: number) => void
}

export function ParameterSlider({ label, value, min, max, step, onChange }: ParameterSliderProps) {
  return (
    <SliderComfortable
      value={value}
      onChange={onChange}
      min={min}
      max={max}
      step={step}
      variant="scrubber"
      label={label}
      formatValue={(currentValue) => currentValue.toFixed(3)}
      // 36px on desktop to match the shader dropdown; the mobile panel keeps
      // SliderComfortable's own 32px.
      className="w-full md:h-9 rounded-[8px]"
    />
  )
}
