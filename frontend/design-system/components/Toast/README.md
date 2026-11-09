# Toast

A short confirmation that floats above the content without moving it. From `src/components/ui.tsx`.

- **Provide:** `message` and `onDone`; `onDone` fires after 4.5 seconds, and you unmount the toast there.
- `nav-bg` ground, `nav-ink` text, a check icon, `radius-toast`, `shadow-toast`. Fixed 24px from the bottom, centred; on phones it sits 84px up, above the bottom bar.
- Use it after a reviewer decision («تصمیم ثبت شد. پرونده بعدی باز است.»). Errors go in a Notice, never a toast.
