// A compact donut with its numbers beside it. The legend names every part, so the
// meaning never depends on color alone, and hovering a part shows its value.
import { formatNumber } from '../lib/format';

export interface PieSlice {
  label: string;
  value: number;
  /** A slot in the chart palette, kept fixed for each meaning. */
  slot: 1 | 2 | 3 | 4;
}

const SIZE = 104;
const RADIUS = 38;
const STROKE = 18;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
// The surface-colored gap between neighboring parts, in stroke length.
const GAP = 2.5;

export function PieChart({ title, slices, emptyText }: { title: string; slices: PieSlice[]; emptyText: string }) {
  const total = slices.reduce((sum, s) => sum + s.value, 0);
  const visible = slices.filter((s) => s.value > 0);
  let offset = 0;

  const description = total === 0 ? emptyText : slices.map((s) => `${s.label}: ${formatNumber(s.value)}`).join('، ');

  return (
    <figure className="pie min-w-0">
      <figcaption className="mb-1.5 text-[0.85rem] font-semibold">{title}</figcaption>
      <div className="flex items-center gap-3.5">
        <svg role="img" aria-label={`${title}. ${description}`} viewBox={`0 0 ${SIZE} ${SIZE}`} width={SIZE} height={SIZE} className="flex-none">
          <g transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}>
            <circle cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} fill="none" stroke="var(--color-surface-2)" strokeWidth={STROKE} />
            {visible.map((s) => {
              const length = (s.value / total) * CIRCUMFERENCE;
              const gap = visible.length > 1 ? GAP : 0;
              const dash = Math.max(length - gap, 1);
              const element = (
                <circle
                  key={s.label}
                  cx={SIZE / 2}
                  cy={SIZE / 2}
                  r={RADIUS}
                  fill="none"
                  stroke={`var(--color-chart-${s.slot})`}
                  strokeWidth={STROKE}
                  strokeDasharray={`${dash} ${CIRCUMFERENCE - dash}`}
                  strokeDashoffset={-offset}
                >
                  <title>{`${s.label}: ${formatNumber(s.value)}`}</title>
                </circle>
              );
              offset += length;
              return element;
            })}
          </g>
          <text x="50%" y="50%" textAnchor="middle" dominantBaseline="central" className={`fill-ink font-bold ${formatNumber(total).length > 4 ? 'text-[10.5px]' : 'text-[17px]'}`}>
            {formatNumber(total)}
          </text>
        </svg>
        {total === 0 ? (
          <p className="text-small text-muted flex-1">{emptyText}</p>
        ) : (
          <ul className="flex max-w-60 min-w-0 flex-1 flex-col gap-0.5 text-caption [&_li]:flex [&_li]:items-center [&_li]:gap-1.5">
            {slices.map((s) => (
              <li key={s.label}>
                <span className="size-2.5 flex-none rounded-swatch" aria-hidden="true" style={{ background: `var(--color-chart-${s.slot})` }} />
                <span className="min-w-0 flex-1 text-muted">{s.label}</span>
                <span className="font-bold tabular-nums">{formatNumber(s.value)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </figure>
  );
}
