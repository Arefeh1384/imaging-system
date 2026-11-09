# Button

The one button, in four variants; `primary` is the default. From `src/components/ui.tsx`.

- **Provide:** `children` (the label, a verb first: «تأیید و پرونده بعدی», «ارسال مدارک»), `onClick`, and any native button attribute. `type` defaults to `button`.
- **variant:** `primary` (accent fill, `accent-ink` text) for the one action a screen exists for; `approve` (green) for approving a case or sending documents; `secondary` (surface, accent text, `line-strong` border) for alternatives such as «تلاش دوباره»; `ghost` (no fill) for «بستن» and in-bar actions; `danger` (surface, `bad-ink` text) for rejecting or returning a case.
- **busy:** shows the spinner before the label and disables the button. Keep the label; don't swap it for «...».
- 44px minimum height, `radius-control` corners, 600 weight; presses scale to 0.985 (off under reduced motion).
- **block** makes it full width. **size:** `default`, `large` (56px, for approving a case) or `patient` (the 62px full-width action on patient screens).
- `buttonClass(variant, size, block)` gives the same classes to a link or a label.
- `ButtonLink` takes `to` and `variant` and renders the same classes on a router link; it needs `RouterProvider` above it.
- Don't put two primary buttons side by side. Don't use color alone to mark danger: the label says what happens.
