'use client'

import { Toaster as Sonner, ToasterProps } from 'sonner'

/**
 * What a toast looks like. Where it goes and how long it stays is set at the
 * call site in app/layout.tsx.
 *
 * Everything here is aimed at one thing: a toast should read as the same
 * furniture as the floating toolbar, because it is the same kind of object — a
 * small raised panel over the artwork. The bar is `Elevated offset={2}
 * shadowLevel={3}`, which resolves to bg-surface-3 + shadow-surface-3, so those
 * are the two tokens matched below.
 */
const Toaster = ({ ...props }: ToasterProps) => {

  return (
    <Sonner
      theme="dark"
      className="toaster group"
      style={
        {
          // --surface-3, not --popover. --popover is near-black against the
          // surface ladder's #252525, so the toast came out markedly darker than
          // the bar it is meant to match. The ladder is what the rest of the
          // app's raised chrome is built on; the toast belongs on it too.
          '--normal-bg': 'var(--surface-3)',
          '--normal-text': 'var(--popover-foreground)',
          // The edge comes from the shadow below, which carries its own hairline
          // ring — that pairing is what makes a surface in this system, and a
          // second --border outline on top of it reads as a drawn box.
          '--normal-border': 'transparent',
        } as React.CSSProperties
      }
      toastOptions={{
        style: {
          borderRadius: '9999px',
          boxShadow: 'var(--shadow-3)',
          // Sonner sizes every toast to the container's fixed 356px, which
          // leaves "Capture saved" sitting in about two hundred pixels of
          // nothing. Shrunk to its contents instead — the toast is one short
          // sentence and should look like one.
          //
          // Re-centring it takes all three of the next properties together. The
          // toast is absolutely positioned and sonner pins it with `left` alone,
          // so a narrower one hangs off the left edge of a box that is still
          // 356px wide. Auto margins do not fix that on their own — with `right`
          // still auto the box is not over-constrained, so the margins have
          // nothing to absorb and resolve to zero. Pinning `right` as well is
          // what makes them split the slack. The container keeps its width and
          // goes on serving as the wrapping bound for anything longer.
          width: 'fit-content',
          left: 0,
          right: 0,
          marginInline: 'auto',
          // 15px, and it is a derived value — do not "correct" it to 12.
          //
          // What you see on the left is a 20x20 disc, not the 16x16 [data-icon]
          // box that contains it: the svg overflows its own box, and sonner also
          // gives that box `margin-left: -3px`. So the inset the eye reads is
          // paddingLeft + that margin, and 15 - 3 lands the disc at 12px.
          //
          // 12 is the number it has to be because it is the gap above and below
          // the disc — (44 - 20) / 2 — and those three gaps should agree. That
          // holds whatever the corner radius is: the disc is vertically centred,
          // so it sits against the flat part of the left edge either way.
          //
          // This was 12px on the theory that the icon carries optical bearing
          // and should sit tighter. That is a rule for letterforms; a filled
          // disc has no bearing to give back, so it read short of its own
          // vertical gap.
          //
          // The right stays wider: text is what ends there, and text does have
          // side bearing, so matching the left would look tight.
          paddingLeft: '15px',
          paddingRight: '16px',
          // 44px, the same as every pill button in the gallery — the toast
          // arrives among them and should be cut from the same stock. Sonner's
          // default 16px block padding made it 53.5px, which is nothing in
          // particular: too tall to be one of the buttons, too short to be a
          // panel.
          //
          // A floor rather than a fixed height, and padding kept under it rather
          // than solved for it. One line is shorter than 44px, so the floor is
          // what sets the height and the padding does nothing; wrap to two and
          // the padding takes over and the pill grows instead of clipping. A
          // fixed height would have to choose, and it would choose wrong on the
          // first long message.
          minHeight: '44px',
          paddingBlock: '8px',
          alignItems: 'center',
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
