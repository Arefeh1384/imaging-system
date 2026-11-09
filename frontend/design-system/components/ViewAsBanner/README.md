# ViewAsBanner

The strip that tells the main admin they are inside someone else's account. From `src/components/ui.tsx`.

- **Provide:** `name` (the account opened) and `onExit`. The «برگشت به پنل مدیریت» link calls `onExit` and goes to `/admin/accounts`.
- `accent-soft` ground with `accent-soft-ink`; pass it to AppShell's `banner` so it sits above the content on every page of that session.
- Needs `RouterProvider` above it.
