# Icon

The app's eleven line icons, drawn at 24 units with a 1.8 stroke in `currentColor`. From `src/components/AppShell.tsx`.

- **Provide:** `name` (folder, user, users, chart, inbox, history, building, file, key, pulse, logout) and optionally `size` (default 22; 20 in buttons).
- Always `aria-hidden`: put the meaning in the text beside it.
- Color comes from the parent's `color`. Add a new icon in the same style (round caps and joins, no fills) rather than mixing in a library. The same drawings are in assets/Icons.
