# Crumbs

The path back up from a detail page, as links separated by «/». From `src/components/ui.tsx`.

- **Provide:** `items` = `[{ label, to? }]`; the last item has no `to` and is marked `aria-current="page"`.
- Needs `RouterProvider` above it. Links are 44px tall for touch.
- Use on admin detail pages: «همه شرکت‌ها / بیمه دانا / بیمارستان میلاد».
