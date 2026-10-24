// A small disclosure panel anchored under its button (P4-10): the button toggles aria-expanded,
// Escape and a press outside close it, and Escape returns focus to the button. Plain React and CSS,
// no `popover` attribute or anchor positioning: those are newer than the Safari floor (spec §5).
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';

/** The least room left between a panel and the window's edge, px. */
const EDGE = 8;

export function Popover({
  label,
  icon,
  children,
  value,
  className,
  title,
  align = 'end',
}: {
  /** The button's text and the panel's accessible name. */
  label: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  /** The current choice, shown on the button instead of the label (named "label: value"). */
  value?: string;
  /** Extra classes for the button, such as a warning state. */
  className?: string;
  title?: string;
  /** Which edge of the button the panel lines up with: the end suits the header's last buttons. */
  align?: 'start' | 'end';
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const panelId = useId();
  // Lined up with its button, the panel may run past the window's edge: on a narrow window (⅓ of
  // an iPad) a button in the middle of a bar, or in a mirrored bar (left-handed layout), leaves no
  // room on its side. Then it moves along until it fits, before it is painted.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const p = panel.current;
      const r = root.current;
      if (!p || !r) return;
      p.style.left = '';
      p.style.right = '';
      const box = p.getBoundingClientRect();
      const width = document.documentElement.clientWidth;
      const shift =
        box.right > width - EDGE ? width - EDGE - box.right : box.left < EDGE ? EDGE - box.left : 0;
      if (shift === 0) return;
      p.style.left = `${box.left + shift - r.getBoundingClientRect().left}px`;
      p.style.right = 'auto';
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (e.target instanceof Node && !root.current?.contains(e.target)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div className={align === 'start' ? 'popover popover--start' : 'popover'} ref={root}>
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={value === undefined ? undefined : `${label}: ${value}`}
        className={className}
        title={title}
        onClick={() => setOpen((o) => !o)}
      >
        {icon}
        <span className="btn-label">{value ?? label}</span>
      </button>
      {open && (
        <div ref={panel} id={panelId} className="popover__panel" role="group" aria-label={label}>
          {children}
        </div>
      )}
    </div>
  );
}
