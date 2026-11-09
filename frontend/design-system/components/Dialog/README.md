# Dialog

A modal on the native `<dialog>`, with a title row and a «بستن» button. From `src/components/ui.tsx`.

- **Provide:** `open`, `title`, `onClose` and the body as `children`. Escape and «بستن» both call `onClose`.
- Up to 620px wide, `radius` corners, a `line` rule under the head, backdrop `rgb(5 15 20 / 55%)`.
- Use it for one document or one form: a radiologist report, a bill, the reject reason.
