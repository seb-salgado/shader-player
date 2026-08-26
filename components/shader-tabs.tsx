"use client"

import { getAllShaderIds, getShaderConfig } from "@/lib/shader-configs"
import { SegmentedTabs } from "./segmented-tabs"

interface ShaderTabsProps {
  shaderId: string
  onShaderChange: (shaderId: string) => void
  /**
   * One prefix per instance. There are two of these mounted at once — the
   * desktop toolbar's, and the one in the mobile controls panel — and the bars
   * are only CSS-hidden, never unmounted. See SegmentedTabs.
   */
  layoutIdPrefix: string
  size?: "desktop" | "mobile"
  /** See SegmentedTabs. The sheet takes `block`; the toolbar keeps the circle. */
  shape?: "circle" | "block"
  disabled?: boolean
}

/**
 * Every shader, always visible. Replaces the dropdown that used to hide the fact
 * that there is more than one shader at all.
 *
 * The control itself is SegmentedTabs, which this shared with the capture-mode
 * picker the moment that arrived; all that is left here is the list.
 *
 * The cells read 01, 02, 03 rather than Haze, Bars and Rings — see `label` on
 * ShaderConfig for why, and `name` beside it for where the words went. That
 * holds at any cell width: the argument there is that the word is falsifiable by
 * the sliders, not that the cell is too small to hold one.
 *
 * A numeral takes the circle shape in the toolbar, where the track is an object
 * in a row and the mode track next to it keeps the pill. The sheet asks for
 * `block` instead — there the track is a row, not an object. Both are passed in
 * for the same reason the shape always is: two of these are mounted at once.
 */
export function ShaderTabs({
  shaderId,
  onShaderChange,
  layoutIdPrefix,
  size = "desktop",
  shape = "circle",
  disabled = false,
}: ShaderTabsProps) {
  const options = getAllShaderIds().map((id) => ({ id, label: getShaderConfig(id).label }))

  return (
    <SegmentedTabs
      options={options}
      value={shaderId}
      onChange={onShaderChange}
      ariaLabel="Shader"
      layoutIdPrefix={layoutIdPrefix}
      layoutIdSuffix="shader-tab"
      size={size}
      shape={shape}
      disabled={disabled}
    />
  )
}
