# Pagination

Goes under every list that comes from the database. Each page is loaded from the server on its own, so a list of 10,000 rows draws only one page. From `src/components/ui.tsx`.

- **Provide:** `page`, `pageSize` and `total` from the API's response, `onPage`, a `label` naming the list («پرونده‌ها»), and optionally `onPageSize` for the size menu.
- Use `usePageParams()` from `src/lib/usePageParams.ts` for the page state. It keeps the page in the address, so refresh and coming back from a case keep it. Give each list its own key when a screen has several.
- A filter change sends the list back to page 1.
- Totals under a table come from the server (`ZipPage.sum`), never from adding up the rows on the page.
- Page sizes are 10, 25, 50 and 100. The server caps a page at 100.
- On phones it shows the first, current and last page numbers. Every button is at least `touch-target` tall.
- Don't use it for a patient's own cases or a case's own events: those lists stay short by nature.
