# Icons

The app's own icon set, from `Icon` in `src/components/AppShell.tsx`, plus the check from `Toast`. 24-unit grid, 1.8px round strokes, no fills (the check is 3px).

Exported single-ink in `ink` light (#12222b). In code they take `currentColor`: use the `Icon` component rather than these files so they recolor with the text.
