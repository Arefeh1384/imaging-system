# LoadState

Loading skeleton or error-with-retry for anything fetched; renders nothing once data is in. From `src/components/ui.tsx`.

- **Provide:** `loading`, `error` (a sentence or null) and optionally `onRetry`.
- Loading shows three shimmer blocks (`surface-2` to `surface`; still under reduced motion) labelled «در حال بارگذاری».
- An error shows a `bad` Notice and, with `onRetry`, a secondary «تلاش دوباره» button.
- Pattern: `<LoadState loading={q.loading} error={q.error} onRetry={q.reload} />` then render the data when present.
