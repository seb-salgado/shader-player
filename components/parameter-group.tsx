"use client"

import { useEffect, useRef, useState } from "react"
import { ChevronRight } from "lucide-react"
import type { ShaderParameterGroup } from "@/lib/shader-configs"
import type { ShaderParams } from "@/lib/shader-uniforms"
import { cn } from "@/lib/utils"
import { ParameterSlider } from "./parameter-slider"
import { ColorPicker } from "./color-picker"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { useCollapsedGroup } from "@/hooks/use-collapsed-group"

interface ParameterGroupProps {
  group: ShaderParameterGroup
  params: ShaderParams
  onChange: (key: string, value: number | string) => void
  // Collapsed state is kept per shader, so the same group name can be open in
  // one shader and closed in another.
  shaderId: string
  // The floating panel packs its groups tighter than the sidebar and sheet do.
  spacing?: "normal" | "compact"
}

export function ParameterGroup({ group, params, onChange, shaderId, spacing = "normal" }: ParameterGroupProps) {
  const gap = spacing === "compact" ? "space-y-1" : "space-y-3"
  // The header-to-parameters gap rides on the content, not on the group root:
  // as `space-y` it became a bottom margin on the header and survived the
  // collapse, leaving dead space under every closed section.
  const headerGap = spacing === "compact" ? "pt-1" : "pt-3"
  const [collapsed, toggleCollapsed] = useCollapsedGroup(shaderId, group.name)
  // The collapse animation needs its content clipped, but a clip that outlives
  // the animation also eats the first slider's hover tooltip, which sits 30px
  // above the slider and so pokes out of the top of an open group. Clip only
  // while the height is actually moving.
  //
  // Starts `true`, so the clip is in the server-rendered markup while the
  // persisted collapsed state takes over during hydration. Later user-driven
  // animations keep managing the same clip through animationstart/end.
  const [animating, setAnimating] = useState(true)
  const [animateDisclosure, setAnimateDisclosure] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)

  // Release that initial clip once hydrated, if nothing is actually running.
  // Fresh mounts intentionally do not animate, so no animationend is coming to
  // clear the flag, and the clip would otherwise be permanent.
  useEffect(() => {
    const el = contentRef.current
    if (el && el.getAnimations().length === 0) setAnimating(false)
  }, [])

  const handleToggle = () => {
    setAnimateDisclosure(true)
    toggleCollapsed()
  }

  return (
    <Collapsible open={!collapsed} onOpenChange={handleToggle}>
      {/* No press scale on either surface: the disclosure itself — the chevron
          turning, the content opening — is the whole receipt this needs, and a
          full-width row dipping under the finger only competes with it. */}
      <CollapsibleTrigger className="group flex h-9 w-full cursor-pointer items-center justify-between text-sm uppercase tracking-wider text-muted-foreground transition-colors duration-[125ms] ease-[cubic-bezier(0.23,1,0.32,1)] hoverFine:text-foreground motion-reduce:transition-none">
        <h3>{group.name}</h3>
        {/* Deliberately not the dropdown's ChevronDown: that one opens a menu
            over the page, this reveals content in place. Pointing right at rest
            keeps the two from looking alike, and the smaller size keeps a
            section header lighter than the shader control it sits under. */}
        <ChevronRight
          className="size-3.5 shrink-0 transition-transform duration-150 motion-reduce:transition-none group-data-[state=open]:rotate-90"
        />
      </CollapsibleTrigger>

      {/* The collapsible-down/up keyframes and the --radix-collapsible-content-height
          they read both ship with tw-animate-css, so the height animation needs
          no CSS of its own. */}
      <CollapsibleContent
        ref={contentRef}
        // Only this element's own collapse animation counts; animation events
        // from anything inside bubble up here too.
        onAnimationStart={(e) => {
          if (e.target === e.currentTarget) setAnimating(true)
        }}
        onAnimationEnd={(e) => {
          if (e.target === e.currentTarget) setAnimating(false)
        }}
        className={cn(
          animateDisclosure &&
            "data-[state=open]:animate-collapsible-down data-[state=closed]:animate-collapsible-up",
          "motion-reduce:animate-none",
          (animating || collapsed) && "overflow-hidden"
        )}
      >
        <div className={cn(headerGap, group.layout === "wrap" ? "flex flex-wrap gap-2" : gap)}>
          {group.parameters.map((param) => {
            if (param.type === "slider") {
              return (
                <ParameterSlider
                  key={param.key}
                  label={param.label}
                  value={params[param.key] as number}
                  min={param.min}
                  max={param.max}
                  step={param.step}
                  onChange={(v) => onChange(param.key, v)}
                />
              )
            }
            return (
              <ColorPicker
                key={param.key}
                label={param.label}
                value={params[param.key] as string}
                onChange={(v) => onChange(param.key, v)}
              />
            )
          })}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
