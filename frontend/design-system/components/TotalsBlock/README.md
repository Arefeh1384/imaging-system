# TotalsBlock

The money summary band: ZIPs received, fee total, and the three shares that add up to it. From `src/components/ui.tsx`.

- **Provide:** `totals` (`Totals` from `src/api/types.ts`: counts plus rial amounts). `single` says «سهم بیمارستان» instead of the plural for one hospital's page.
- One band instead of a row of identical tiles: two headline figures in the `figure` style, then SplitBar and a labelled share under each color.
- Use it once, at the top of a finance page.
