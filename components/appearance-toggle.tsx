"use client"

import { useEffect, useState } from "react"
import { useTheme } from "next-themes"
import { Moon, Sun } from "lucide-react"
import { AnimatePresence, motion, useReducedMotion } from "framer-motion"
import { FluidTooltip } from "@/components/ui/tooltip"
import { spring } from "@/lib/springs"

export function AppearanceToggle() {
  const [mounted, setMounted] = useState(false)
  const { resolvedTheme, setTheme } = useTheme()
  const prefersReducedMotion = useReducedMotion()

  useEffect(() => setMounted(true), [])

  // System preference remains the unsaved default. Once the user clicks, the
  // resolved opposite is stored as an explicit light or dark preference.
  const targetTheme = resolvedTheme === "dark" ? "light" : "dark"
  const Icon = targetTheme === "dark" ? Moon : Sun
  const label = mounted ? `Switch to ${targetTheme} mode` : "Appearance"

  return (
    <FluidTooltip content={label} side="top">
      <button
        type="button"
        onClick={() => setTheme(targetTheme)}
        aria-label={label}
        // The negative margin preserves the 16px glyph's right-edge alignment
        // while allowing the circular hit target to grow to 44px.
        className="-mr-[14px] shrink-0 flex size-11 items-center justify-center rounded-full text-muted-foreground transition-[color,background-color,transform] duration-150 ease-out hoverFine:text-foreground hoverFine:bg-foreground/[0.06] active:scale-[0.97] motion-reduce:transition-none"
      >
        {/* The icon names the action, matching the tooltip and accessible name. */}
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={mounted ? targetTheme : "unresolved"}
            initial={prefersReducedMotion ? false : { opacity: 0, y: 3 }}
            animate={{ opacity: 1, y: 0 }}
            exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: -3, transition: spring.fast.exit }}
            transition={spring.fast}
            className="flex"
          >
            {mounted ? <Icon className="size-4" strokeWidth={1.7} /> : <span className="size-4" />}
          </motion.span>
        </AnimatePresence>
      </button>
    </FluidTooltip>
  )
}
