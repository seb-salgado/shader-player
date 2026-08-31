"use client"

import { ColorPickerPopover } from "@/components/ui/color-picker"

interface ColorPickerProps {
  label?: string
  value: string
  onChange: (value: string) => void
}

export function ColorPicker({ label, value, onChange }: ColorPickerProps) {
  const picker = (
    <ColorPickerPopover
      value={value}
      onValueChange={(nextValue) => onChange(nextValue)}
      defaultFormat="hex"
      triggerShowValue
      triggerClassName="gap-1.5 rounded-full pl-2 pr-3"
      // Unlabeled swatches sit in a wrapping row, so they size to their content
      // instead of claiming the full width and forcing one per line.
      wrapperClassName={label ? undefined : "w-auto"}
    />
  )

  if (!label) return picker

  return (
    <div className="flex items-center gap-3">
      <span className="shrink-0 text-[13px] text-muted-foreground select-none">{label}</span>
      <div className="flex-1 min-w-0">{picker}</div>
    </div>
  )
}
