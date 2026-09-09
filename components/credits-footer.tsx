export function CreditsFooter() {
  return (
    <div className="mt-auto">
      {/* Full-width divider with negative margins to counteract parent padding */}
      <div className="h-px bg-border -mx-4 mb-4" />
      {/* Still a flex row with `min-w-0` below, though the appearance toggle it
          used to hold is gone with light mode. The row survives it: `min-w-0` is
          what lets the credit line shrink below its 206px natural width inside a
          247px column, which is a constraint the text has whether or not
          anything sits beside it. */}
      <div className="flex items-center justify-between gap-2">
        {/* The parameter groups' heading style, and the same one: `text-sm
            uppercase tracking-wider text-muted-foreground`, straight off
            ParameterGroup's CollapsibleTrigger. This line is a label on the
            panel, not content in it — the same thing every SECTION TITLE above
            it is — so it belongs in that voice rather than in the foreground
            colour it used to borrow from the parameter rows. */}
        <p className="min-w-0 text-sm uppercase tracking-wider text-muted-foreground mt-0 py-2.5">
          Made by{" "}
          <a
            href="https://sebsalgado.com"
            target="_blank"
            rel="noopener noreferrer"
            className="underline decoration-dotted underline-offset-2 hover:opacity-80 transition-opacity"
          >
            Sebastião Salgado
          </a>
        </p>
      </div>
    </div>
  )
}
