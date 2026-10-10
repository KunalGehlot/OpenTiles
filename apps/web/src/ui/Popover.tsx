// A small disclosure panel anchored under its button (P4-10): the button toggles aria-expanded,
// Escape and a press outside close it, and Escape returns focus to the button. Plain React and CSS,
// no `popover` attribute or anchor positioning: those are newer than the Safari floor (spec §5).
import { useEffect, useId, useRef, useState } from 'react';

export function Popover({
  label,
  icon,
  children,
}: {
  /** The button's text and the panel's accessible name. */
  label: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panelId = useId();

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
    <div className="popover" ref={root}>
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        {icon}
        <span className="btn-label">{label}</span>
      </button>
      {open && (
        <div id={panelId} className="popover__panel" role="group" aria-label={label}>
          {children}
        </div>
      )}
    </div>
  );
}
