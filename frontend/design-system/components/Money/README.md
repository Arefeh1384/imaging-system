# Money

An amount in Toman with Persian digits, from a value in rials. From `src/components/ui.tsx`.

- **Provide:** `rial` (a number of rials; the API and storage always use rials). `unit={false}` drops the «تومان» suffix when a heading already says it.
- It divides by 10, rounds, and formats with `fa-IR` grouping, in tabular numerals.
- Never format money yourself in a screen: use `Money`, or `formatToman()` from `src/lib/format.ts` in plain strings.
