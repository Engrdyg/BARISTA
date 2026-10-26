import { useEffect, useRef, useState } from 'react';

export interface Utterance {
  text: string;
  /** Pause after this item, in ms (e.g. between a card's front and back). */
  pauseAfter?: number;
}

/** Reads a list aloud with the browser's speech synthesis. */
export default function Listen({ items, label = 'Listen' }: { items: Utterance[]; label?: string }) {
  const [playing, setPlaying] = useState(false);
  const [index, setIndex] = useState(0);
  const [rate, setRate] = useState(1);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window;

  useEffect(() => () => {
    clearTimeout(timer.current);
    if (supported) window.speechSynthesis.cancel();
  }, [supported]);

  useEffect(() => {
    if (!playing || !supported) return;
    const item = items[index];
    if (!item) {
      setPlaying(false);
      setIndex(0);
      return;
    }
    const u = new SpeechSynthesisUtterance(item.text);
    u.rate = rate;
    u.lang = 'en-PH';
    u.onend = () => {
      timer.current = setTimeout(() => setIndex((i) => i + 1), item.pauseAfter ?? 400);
    };
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
    return () => {
      u.onend = null;
      clearTimeout(timer.current);
    };
  }, [playing, index, rate, items, supported]);

  if (!supported || !items.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <button
        className="btn btn-sm"
        onClick={() => {
          if (playing) {
            window.speechSynthesis.cancel();
            setPlaying(false);
          } else setPlaying(true);
        }}
      >
        {playing ? 'Pause' : index ? 'Resume' : label}
      </button>
      {(playing || index > 0) && (
        <>
          <button className="btn btn-sm btn-ghost" onClick={() => setIndex((i) => Math.min(items.length, i + 1))}>
            Skip
          </button>
          <span className="text-xs text-muted tabular-nums">
            {Math.min(index + 1, items.length)} / {items.length}
          </span>
        </>
      )}
      <select className="select w-auto py-1 text-sm" value={rate} onChange={(e) => setRate(Number(e.target.value))} aria-label="Speed">
        {[0.75, 1, 1.25, 1.5].map((r) => (
          <option key={r} value={r}>
            {r}×
          </option>
        ))}
      </select>
    </div>
  );
}
