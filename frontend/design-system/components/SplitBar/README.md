# SplitBar

The fee split as one bar of three shares: hospital, insurance, management. From `src/components/ui.tsx`.

- **Provide:** `split` = `{ hospitalRial, insuranceRial, managementRial }`. Widths are each share over their sum.
- Colors are fixed: `share-hospital`, `share-insurance`, `share-management`. The bar carries an `aria-label` with all three amounts.
- Always show it with a legend that names each share (TotalsBlock does this); the insurance and management colors are too close to `surface-2` to stand alone.
