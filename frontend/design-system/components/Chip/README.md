# Chip

A pill naming a case or ZIP status, with a dot in its own ink. From `src/components/ui.tsx`.

- **Provide:** `status` = `{ label, tone }`. The app builds these with `stageLabel()` and `zipStatusLabel()` in `src/lib/labels.ts`; reuse those words, don't invent new ones.
- **tone:** `ok` approved («تأیید نهایی بیمه»), `warn` waiting on someone («در انتظار بیمار»), `bad` returned or rejected («برگشت از پزشک به بیمار»), `info` with a reviewer («نزد پزشک بیمه»), `neutral` duplicate or system («تکراری»).
- The words carry the meaning; the color only repeats it. Never show a chip without a label.
- Text on its tone ground holds 7:1 or better in both themes.
