"use client"

import type { ShaderParams } from "@/lib/shader-uniforms"
import { ParameterGroup } from "./parameter-group"
import { getShaderConfig } from "@/lib/shader-configs"
import { CreditsFooter } from "./credits-footer"

interface ControlsSidebarProps {
  params: ShaderParams
  setParams: (params: ShaderParams) => void
  shaderId: string
  onResizeStart: (event: React.PointerEvent<HTMLElement>) => void
  isResizing: boolean
}

export function ControlsSidebar({
  params,
  setParams,
  shaderId,
  onResizeStart,
  isResizing,
}: ControlsSidebarProps) {
  const updateParam = (key: string, value: number | string) => {
    setParams({ ...params, [key]: value })
  }

  const shaderConfig = getShaderConfig(shaderId)

  return (
    // No width transition: it would lag behind the pointer during a drag. The
    // scroll lives on the inner column, not here — `overflow-y-auto` computes
    // `overflow-x` to `auto` too, which would clip the half of the grip that
    // hangs outside this box.
    //
    // The 315px fallback is not decoration: --sidebar-width is only set once
    // something has been stored, so on a first visit this *is* the width. Keep
    // it in step with DEFAULT_SIDEBAR_WIDTH in lib/sidebar-width.ts by hand —
    // Tailwind cannot read a constant, the same constraint the mobile panel's
    // detent classes document.
    <div className="relative w-[var(--sidebar-width,315px)] shrink-0 h-full bg-background flex flex-col">
      {/* Resize grip. A 6px strip gives the pointer something to catch; the 1px
          line inside is the visible part. With no border here any more, that
          line is the only seam this edge ever draws — transparent at rest, so
          the panel meets the canvas on its own colour change, and tinted only
          while hovered or dragged. */}
      <div
        onPointerDown={onResizeStart}
        aria-hidden
        className="group absolute inset-y-0 -left-[3px] z-20 w-[6px] cursor-col-resize touch-none"
      >
        <div
          className={`h-full w-px transition-colors duration-150 motion-reduce:transition-none ${
            isResizing ? "bg-foreground/20" : "bg-transparent group-hoverFine:bg-foreground/20"
          }`}
        />
      </div>

      {/* The scroll container has to be its own wrapper: putting the overflow on
          the padded column below turns that column into a definite-height flex
          parent, and its children — the parameter groups — get squashed instead
          of keeping their natural height. */}
      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col">
        {/* Parameters only. Choosing a shader is the floating toolbar's job. */}
        <div className="p-4 space-y-5 bg-background flex-1 flex flex-col">
          {shaderConfig.parameterGroups.map((group) => (
            <ParameterGroup
              // Keyed by shader too, not by group name alone. Two shaders can
              // name a group the same thing — "Vertical Wave" and "Horizontal
              // Wave" exist in both Gradient Wave and Pixel Topography — and a
              // bare name key makes React reuse the instance across the switch.
              // The Collapsible inside then keeps the height it measured for the
              // *other* shader's parameter count and replays its open animation
              // against it, so the group renders clipped to a stale height.
              key={`${shaderId}:${group.name}`}
              group={group}
              params={params}
              onChange={updateParam}
              shaderId={shaderId}
            />
          ))}

          {/* Appearance lives in the credits row now, as a single cycling icon
              rather than its own labelled section. */}
          <div className="mt-auto">
            <CreditsFooter showAppearanceToggle />
          </div>
        </div>
      </div>
    </div>
  )
}
