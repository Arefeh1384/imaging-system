Imaging Claims is the imaging records and insurance system (سامانه مدارک تصویربرداری و بیمه): a Persian, right-to-left product where a ZIP arrives from a hospital's PACS, the patient fills in what is missing from their phone, and an insurance doctor and employee decide. The layout idea is **a calm case file**: a status column beside one clear action, and money shown as three named shares that always add up. One memorable motif, the scanner's rings; everything else stays calm.

## Content

- **Persian first, RTL everywhere.** Set `lang="fa" dir="rtl"` on the root. Use logical CSS properties (`inline-start`, `padding-inline`), never left and right.
- **Persian digits in everything a person reads**: counts, dates, money (`۱۲٬۴۸۰٬۰۰۰`). Use `Money` or `formatToman()` / `formatNumber()` from `src/lib/format.ts`. Dates use the Persian calendar (`fa-IR-u-ca-persian`): «۱۲ آبان ۱۴۰۵».
- **Latin codes stay as typed** and run left-to-right: wrap IDs, usernames and codes like `PL-5007` in `.ltr` (the `code` style).
- **Money is stored in rials and shown in Toman** (rial / 10), always with «تومان» or a heading that says it.
- **Plain, polite, short.** Sentences say what happened and what is next: «ذخیره شد و جمع‌های بیمارستان و شرکت به‌روز شد.» «این مدارک در ZIP نبود و بیمار باید بارگذاری کند.» No exclamation marks, no emoji.
- **Address the reader with شما** where needed; buttons start with the verb: «ارسال مدارک», «تأیید و پرونده بعدی», «تلاش دوباره», «بستن».
- **Errors say what is right**: «شماره ۱۱ رقمی با ۰۹ شروع می‌شود.», not «ورودی نامعتبر».
- **Status words are fixed.** Use the labels in `src/lib/labels.ts` (`stageLabel`, `zipStatusLabel`, `DOC_LABELS`): «در انتظار بیمار», «نزد پزشک بیمه», «برگشت از پزشک به بیمار», «تأیید نهایی بیمه». Don't paraphrase them per screen.
- **AI is a suggestion.** Staff screens say so («این فقط پیشنهاد است و تصمیم با شماست.»). Patients never see AI results or amounts.

## Color

- Two themes, `light` and `dark`, both complete. The app follows the system setting and `data-theme` overrides it.
- **Grounds:** `bg` behind everything, `surface` for cards, tables, inputs and dialogs, `surface-2` for hover and disabled. Text is `ink`; secondary text is `muted`. Both read on all three grounds in both themes.
- **Teal is the brand.** `accent` for primary buttons, links and the active menu label; text on an accent fill is `accent-ink` (white in light, dark teal in dark, because the dark accent is light). Tinted grounds are `accent-soft` with `accent-soft-ink`.
- **The menu, sign-in panel and toast** sit on `nav-bg` with `nav-ink`, `nav-muted` for roles and taglines, and `nav-active` for the rings.
- **Status** is five ground/ink pairs: `ok-*`, `warn-*`, `bad-*`, `neutral-*`, and `accent-soft` for info. Each pair is 7:1 or better. Status always carries a word; color only repeats it.
- **Paper stays paper.** Bills, reports and prescriptions render on `paper` with `paper-ink` and `paper-line` in both themes. Medical images sit on `viewer` with `viewer-ink`; `scan` green is only for the scanner and the viewer.
- **Money shares** are fixed: `share-hospital` (teal), `share-insurance` (amber), `share-management` (grey-teal), always with a labelled legend.
- **Charts** use `chart-1` to `chart-4` as fixed slots, each meaning one thing across every chart; the legend names every part.
- **Known contrast gaps, kept as the source has them:** `focus` is 2.7:1 on `surface` in light (under 3:1); `line-strong` is 2.98:1 on `surface` in light; `chart-3`, `chart-4`, `share-insurance` and `share-management` are under 3:1 in light. The legends and labels carry the meaning where those colors appear.

## Type

- One family, **Vazirmatn** (variable, 100–900), in the `sans` stack with Tahoma as the fallback. The app loads it from `@fontsource-variable/vazirmatn`.
- Body is `body`: 15px at 1.7 leading. Persian needs the tall leading; don't tighten it.
- Page titles are `title` (1.7rem, 800). Card and dialog headings `heading`, names inside cards `subheading`. Field labels `label`, metadata `small`, chips and table headers `caption`, the brand subtitle `micro`.
- Figures: `figure` for the headline numbers in the money band, `kpi` for single figures. All numbers use tabular numerals (`.num`, and every table).
- **The patient panel is bigger**: wrap it in `.patient` to get `patient-body` (18px, 1.75), `patient-title` and the 62px `patient-button`. One thing per screen.
- `mono` only for `.ltr` codes.

## Layout and shape

- Spacing comes from a short list of literal steps (`space-2` to `space-48`). The defaults: 8px between items in a row, 16px between stacked blocks and as the page gutter, 20px card padding, 24px / 48px page top and bottom.
- Content maxes out at 1240px, or 1600px on screens from 1620px. The side menu is `side-menu` on the right; from 861px to 1279px it narrows to a rail, and under `collapse` (860px) it becomes a bottom bar.
- Every tap target is at least `touch-target` (44px); on patient screens `patient-target` (62px) for the main action.
- **Radii:** `radius` (14px) for cards, notices, dialogs and bands; `radius-control` (10px) for buttons, inputs and menu items; `radius-pill` for chips and badges; `radius-toast` (12px) for the toast and patient button.
- **Elevation is one shadow.** Cards, KPI blocks and the money band use `shadow` and drop their border. `shadow-toast` is only for the toast. No other shadows.
- **The scanner rings** are the one decorative motif: repeating radial rings in `nav-active` on `nav-bg`, behind the sign-in panel, the foot of the side menu and the patient profile band. Don't use them elsewhere or in other colors.

## States and motion

- Focus is a 3px solid `focus` outline with a 2px offset on every focusable element.
- Hover: rows and secondary buttons go to `surface-2`; the primary button brightens to 1.12.
- Press: buttons scale to 0.985.
- Disabled: 50% opacity on buttons; `surface-2` and `muted` on inputs.
- Loading is a shimmer skeleton (`LoadState`) or a spinner inside the button (`busy`). Never a full-page spinner.
- Motion is short and functional: toast rises in 0.25s, the scanner line sweeps over a photo, a check draws after sending. Every animation stops under `prefers-reduced-motion`.

## Icons and marks

- The mark is `BrandMark`: a lens of two rings and four ticks on an `accent` tile. There is no wordmark; set «تصویربرداری و بیمه» (short) or «سامانه مدارک تصویربرداری و بیمه» (full) in type beside it.
- Icons are the app's own eleven line icons (`Icon`), 24-unit grid, 1.8px round strokes in `currentColor`, always `aria-hidden` next to a text label. Draw new ones in the same style; don't mix in an icon library.

## Components

- The components are the app's own: `src/components/ui.tsx`, `AppShell.tsx`, `PieChart.tsx` and `StudyGallery.tsx`. Each one has its rules in `components/<Name>/README.md` here, and its props in `components/index.d.ts`.
- Styles are Tailwind classes in the components. Shared class lists used on many screens are in `src/components/classes.ts`: `CARD`, `CARD_FLUSH`, `INPUT`, `LIST_ROW` and so on.
- Build a staff screen as `AppShell` > `PageTitle` > cards. Build a sign-in as `AuthLayout` with `Field`s and one `Button`. Show status with `Chip`, messages with `Notice`, money with `Money`, `SplitBar` and `TotalsBlock`, and any list from the database with `Pagination`.
- The case views in `src/components/case.tsx` and `src/components/documents.tsx` follow these rules but have no notes of their own.

## How this connects to the app

- `tokens.json` decides the values. `npm run tokens` writes them to `src/styles/tokens.css` as Tailwind's theme; `npm run dev` and `npm run build` do this by themselves. Don't edit `tokens.css`.
- Each token becomes Tailwind classes:
  - colors: `bg-surface`, `text-ink`, `border-line`, `fill-ok-bg`
  - font sizes: `text-title`, `text-small`, `text-patient-body`
  - radii: `rounded-card` (the `radius` token), `rounded-control`, `rounded-toast`, `rounded-pill`
  - shadows: `shadow-card` (the `shadow` token), `shadow-toast`, `shadow-sheet`
  - layout: `min-h-touch-target`, `min-h-patient-target`, `w-side-menu`, `max-w-page`
- Tailwind's default colors and font sizes are turned off, so only these tokens can be used.
- `collapse` sets the `lg` breakpoint: `max-lg:` means at or below 860px. `max-sm:` is 620px, `max-md:` is 700px, `xl:` starts at 1100px, `wide:` at 1280px and `2xl:` at 1620px. `short:` means a screen 500px tall or less, such as a phone on its side.
- Rows of cards or fields use `flex flex-wrap` with a grow basis, not a fixed grid, so a last item fills its line instead of sitting stranded. Tables decide for themselves whether to stack (`ResponsiveTable`).
- Changing spacing tokens, line heights or font weights does nothing: those are written as Tailwind classes in the components.
