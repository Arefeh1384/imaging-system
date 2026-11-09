# PieChart

A compact donut with its total in the middle and a legend that names every part. From `src/components/PieChart.tsx`.

- **Provide:** `title`, `slices` (`{ label, value, slot }`, slot 1 to 4) and `emptyText` for when every value is 0.
- Slots keep one meaning across charts: in case status, 3 is approved, 1 in review, 2 returned, 4 waiting on the patient. Reuse that mapping.
- The legend lists every slice with its number, so meaning never depends on color; hovering a part shows its value; the SVG has a full `aria-label`.
- Lay several out in `<div className="pie-grid">`.
