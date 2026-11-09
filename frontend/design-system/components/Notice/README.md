# Notice

A full-width message block in one of the five tones. From `src/components/ui.tsx`.

- **Provide:** `tone` and `children` (one or two plain sentences). `busy` adds the spinner before the text.
- `bad` notices get `role="alert"`; every other tone gets `role="status"`.
- Use `ok` to confirm a save, `warn` for sample mode or something the reader must act on, `bad` for a failed load or a rejected ZIP with its reason, `info` for progress, `neutral` for facts that need no action.
- Radius is `radius`, padding 12px 16px, weight 500. Don't stack more than two at once.
