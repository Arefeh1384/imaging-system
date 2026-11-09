// Class lists used on many screens, so a change to a card or an input happens in one place.

/** A text box or select on staff screens. */
export const INPUT =
  'min-h-touch-target w-full rounded-control border border-[#c8cdd8] bg-surface px-3 text-ink disabled:bg-surface-2 disabled:text-muted aria-invalid:border-bad-ink focus:border-accent focus:shadow-[0_0_0_4px_var(--color-accent-soft)] focus:outline-none';

/** The larger text box on patient screens. */
export const PATIENT_INPUT =
  'min-h-[58px] w-full rounded-control border-2 border-[#c8cdd8] bg-surface px-3.5 text-[1.15em] text-ink aria-invalid:border-bad-ink focus:border-accent focus:shadow-[0_0_0_4px_var(--color-accent-soft)] focus:outline-none';

/** A white card with padding. */
export const CARD =
  'min-w-0 rounded-card border border-line bg-surface p-5 max-lg:border-transparent';

/** A card whose content, such as a table, runs to its edges. */
export const CARD_FLUSH =
  'min-w-0 overflow-hidden rounded-card border border-line bg-surface max-lg:border-transparent';

/** The title row of a flush card. */
export const CARD_HEAD =
  'flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3';

/** One row of a list inside a card. */
export const LIST_ROW =
  'flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-line px-3.5 py-2.5 first:border-t-0';

/** A link with room to tap. */
export const TEXT_LINK =
  'inline-flex min-h-touch-target items-center font-semibold text-accent';

/** A card of rows on patient screens. */
export const PATIENT_CARD =
  'rounded-card border border-line bg-surface px-4 py-1.5 max-lg:border-transparent';

/** A label and value on patient screens. */
export const PATIENT_ROW =
  'flex min-h-[52px] flex-wrap items-center justify-between gap-x-3 gap-y-0.5 border-t border-line py-2 first:border-t-0';

/** The side margin of a page, clear of a phone's notch. */
export const GUTTER =
  'pl-[max(16px,env(safe-area-inset-left,0px))] pr-[max(16px,env(safe-area-inset-right,0px))]';

/** Form fields in a row. Unlike a grid, a field left alone on the last line fills it instead of sitting stranded. */
export const FIELD_ROW = 'flex flex-wrap gap-3.5 [&>*]:min-w-0 [&>*]:flex-[1_1_210px]';
