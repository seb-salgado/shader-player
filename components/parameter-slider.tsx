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
      // 36px in both panels. It matched the shader dropdown on desktop and let
      // mobile keep SliderComfortable's own 32px, back when nothing in the sheet
      // had to line up with it. The sheet's shader track is on the same number
      // now — see SIZES in segmented-tabs.tsx — and a row of 36s under a 32 was
      // the one control in that column sitting at its own height.
      className="w-full h-9 rounded-[8px]"
    />
  )
}
