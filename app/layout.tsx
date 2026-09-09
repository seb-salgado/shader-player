import type React from "react"
import type { Viewport } from "next"
import { Space_Mono } from "next/font/google"
import "./globals.css"
// Blossom only enhances the gallery's scroller on pointer devices, but its
// stylesheet is what the scroller itself is built on — Next wants it from the
// root entry point, not from the client component that renders the carousel.
import "@blossom-carousel/react/style.css"
import { AudioInitializer } from "@/components/audio-initializer"
import { SIDEBAR_WIDTH_BOOT_SCRIPT } from "@/lib/sidebar-width"
import { INPUT_MODALITY_BOOT_SCRIPT } from "@/lib/input-modality"

const spaceMono = Space_Mono({
  weight: ["400", "700"],
  subsets: ["latin"],
  variable: "--font-mono",
})

export const metadata = {
  title: "Shader Playground",
  description: "Interactive GLSL shader playground",
  icons: {
    icon: [
      { url: "/icon-light.png", type: "image/png", media: "(prefers-color-scheme: light)" },
      { url: "/icon-dark.png", type: "image/png", media: "(prefers-color-scheme: dark)" },
    ],
  },
}

// viewport-fit=cover is what makes env(safe-area-inset-*) resolve to anything
// other than 0 — the mobile control bar sits against the home indicator.
export const viewport: Viewport = {
  viewportFit: "cover",
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    // `dark` is static rather than provider-driven: this app is dark-only, and
    // the class is here for `@custom-variant dark` in app/globals.css (the
    // `dark:` utilities in components/ui still read it) rather than for the
    // palette, which is now plain `:root`.
    //
    // suppressHydrationWarning stays, but no longer for next-themes — the two
    // boot scripts below both write to document.documentElement before React
    // sees it.
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className={spaceMono.variable}>
        {/* First thing in the body so it executes before the markup below is
            parsed, which is what lets the stored sidebar width be in place for
            the very first paint instead of one paint late. */}
        <script dangerouslySetInnerHTML={{ __html: SIDEBAR_WIDTH_BOOT_SCRIPT }} />
        {/* Beside it for the same reason: the first tap on a phone lands well
            before hydration, and it is the one that decides whether the gallery
            opens with a ring around its close button. */}
        <script dangerouslySetInnerHTML={{ __html: INPUT_MODALITY_BOOT_SCRIPT }} />
        <AudioInitializer />
        {children}
      </body>
    </html>
  )
}
