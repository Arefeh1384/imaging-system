// The photo with the sheet's four corners on it. The patient drags a corner (or moves it with the arrow keys)
// onto the corner of the paper; a magnifier shows what is under the finger.
import { useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import type { Point, Quad } from '../../lib/scan';

const NAMES = ['گوشه بالا و چپ برگه', 'گوشه بالا و راست برگه', 'گوشه پایین و راست برگه', 'گوشه پایین و چپ برگه'];
const LOUPE = 116;
const ZOOM = 2.5;

/** The photo with an outline over it, sized to the photo so the outline lines up at any width. */
export function PhotoFrame({ src, width, height, quad, children, alt = '' }: { src: string; width: number; height: number; quad?: Quad; children?: ReactNode; alt?: string }) {
  return (
    <div className="relative mx-auto w-fit max-w-full select-none">
      <img src={src} alt={alt} draggable={false} className="block h-auto max-h-[52dvh] w-auto max-w-full rounded-card short:max-h-[46dvh]" />
      {quad ? (
        <svg className="pointer-events-none absolute inset-0 size-full overflow-visible" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
          <path d={`M0 0H${width}V${height}H0Z M${quad.map((p) => `${p.x} ${p.y}`).join('L')}Z`} fillRule="evenodd" className="fill-black/45" />
          <polygon points={quad.map((p) => `${p.x},${p.y}`).join(' ')} className="fill-none stroke-scan" strokeWidth={3} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        </svg>
      ) : null}
      {children}
    </div>
  );
}

export function CornerEditor({ src, width, height, quad, onChange }: { src: string; width: number; height: number; quad: Quad; onChange: (next: Quad) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<number | null>(null);

  const move = (index: number, to: Point) => {
    const next = [...quad] as Quad;
    next[index] = { x: Math.max(0, Math.min(width, to.x)), y: Math.max(0, Math.min(height, to.y)) };
    onChange(next);
  };

  const fromPointer = (event: PointerEvent): Point | null => {
    const rect = box.current?.getBoundingClientRect();
    if (!rect) return null;
    return { x: ((event.clientX - rect.left) / rect.width) * width, y: ((event.clientY - rect.top) / rect.height) * height };
  };

  const onDown = (index: number) => (event: PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(index);
  };
  const onMove = (index: number) => (event: PointerEvent<HTMLButtonElement>) => {
    if (dragging !== index) return;
    const at = fromPointer(event);
    if (at) move(index, at);
  };
  const onUp = () => setDragging(null);

  const onKey = (index: number) => (event: KeyboardEvent<HTMLButtonElement>) => {
    const step = (event.shiftKey ? 0.03 : 0.006) * Math.max(width, height);
    const delta: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const d = delta[event.key];
    if (!d) return;
    event.preventDefault();
    move(index, { x: quad[index].x + d[0], y: quad[index].y + d[1] });
  };

  const rect = box.current?.getBoundingClientRect();
  const held = dragging !== null ? quad[dragging] : null;

  return (
    <PhotoFrame src={src} width={width} height={height} quad={quad}>
      <div ref={box} className="absolute inset-0">
        {quad.map((p, i) => (
          <button
            key={i}
            type="button"
            className="corner-handle group absolute flex size-11 -translate-x-1/2 -translate-y-1/2 touch-none items-center justify-center rounded-full outline-none"
            style={{ left: `${(p.x / width) * 100}%`, top: `${(p.y / height) * 100}%` }}
            aria-label={`${NAMES[i]}. با کلیدهای جهت جابه‌جا کنید.`}
            onPointerDown={onDown(i)}
            onPointerMove={onMove(i)}
            onPointerUp={onUp}
            onPointerCancel={onUp}
            onKeyDown={onKey(i)}
          >
            <span className={`block size-6 rounded-full border-[3px] border-white bg-scan shadow-[0_0_0_1.5px_rgb(0_0_0/0.45),0_2px_6px_rgb(0_0_0/0.4)] transition-transform group-focus-visible:outline-3 group-focus-visible:outline-offset-2 group-focus-visible:outline-focus motion-reduce:transition-none ${dragging === i ? 'scale-125' : ''}`} />
          </button>
        ))}
      </div>
      {held && rect ? (
        // Above the finger, or below it near the top of the photo, so the finger never covers it.
        <div
          className="pointer-events-none absolute z-10 overflow-hidden rounded-full border-[3px] border-white shadow-[0_4px_16px_rgb(0_0_0/0.45)]"
          style={{
            width: LOUPE,
            height: LOUPE,
            left: Math.max(0, Math.min(rect.width - LOUPE, (held.x / width) * rect.width - LOUPE / 2)),
            top: (held.y / height) * rect.height > LOUPE + 40 ? (held.y / height) * rect.height - LOUPE - 36 : (held.y / height) * rect.height + 36,
            backgroundImage: `url(${src})`,
            backgroundSize: `${rect.width * ZOOM}px ${rect.height * ZOOM}px`,
            backgroundPosition: `${LOUPE / 2 - (held.x / width) * rect.width * ZOOM}px ${LOUPE / 2 - (held.y / height) * rect.height * ZOOM}px`,
          }}
          aria-hidden="true"
        >
          <span className="absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 bg-scan/90" />
          <span className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-scan/90" />
        </div>
      ) : null}
    </PhotoFrame>
  );
}
