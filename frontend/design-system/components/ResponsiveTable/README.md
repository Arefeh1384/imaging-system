# ResponsiveTable

A table wrapper that turns rows into labelled stacks when its own width is narrow, so nothing scrolls sideways. From `src/components/ui.tsx`.

- **Provide:** a plain `<table>` with `<thead>`, `<tbody>` and optionally `<tfoot>` as `children`; each header's text becomes the label of its cells when stacked.
- It measures the table itself: when the columns don't fit, whatever the device, rows become labeled lines. From 560px of width those lines sit in two columns. There are no fixed breakpoints to maintain.
- Put it inside a `CARD_FLUSH` section, with `Pagination` under it. Numbers go in `text-end` cells; the row's link is `font-semibold text-accent`.
- `tfoot` rows are totals: `accent-soft` ground, `accent-soft-ink`, bold. Rows hover to `surface-2`.
