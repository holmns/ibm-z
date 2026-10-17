"use client";

import { useEffect, useId, useState } from "react";
import type { Place } from "@/lib/types";
import { inputClass, Spinner } from "./ui";

export function PlaceSearch({ value, onChange }: { value: Place; onChange: (p: Place) => void }) {
  const id = useId();
  // what the user is typing; null shows the chosen place
  const [draft, setDraft] = useState<string | null>(null);
  const [results, setResults] = useState<Place[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const text = draft ?? value.name;

  useEffect(() => {
    const q = draft?.trim() ?? "";
    if (q.length < 2) return;
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await fetch(`/api/places?q=${encodeURIComponent(q)}`, { signal: ctrl.signal });
        const body = await r.json();
        setFailed(!r.ok);
        setResults(body.places ?? []);
        setActive(0);
        setOpen(true);
      } catch (e) {
        if ((e as Error).name !== "AbortError") setFailed(true);
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [draft]);

  const choose = (p: Place) => {
    onChange(p);
    setDraft(null);
    setOpen(false);
  };

  return (
    <div className="relative">
      <div className="relative">
        <input
          id={id}
          role="combobox"
          aria-expanded={open && results.length > 0}
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          autoComplete="off"
          spellCheck={false}
          className={`${inputClass} pr-9`}
          value={text}
          placeholder="Search a park or address"
          onChange={(e) => {
            setDraft(e.target.value);
            if (e.target.value.trim().length < 2) {
              setResults([]);
              setOpen(false);
            }
          }}
          onFocus={(e) => e.target.select()}
          onBlur={() => setTimeout(() => {
            setOpen(false);
            setDraft(null);
          }, 120)}
          onKeyDown={(e) => {
            if (!open || !results.length) return;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(results.length - 1, a + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(0, a - 1));
            } else if (e.key === "Enter") {
              e.preventDefault();
              choose(results[active]);
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
        />
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-muted">
          {loading ? <Spinner /> : (
            <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
              <circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" strokeWidth="1.6" />
              <path d="M11 11l3.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          )}
        </span>
      </div>
      {open && (
        <ul
          id={`${id}-list`}
          role="listbox"
          className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-lg border border-line bg-surface py-1 shadow-[0_8px_24px_rgba(11,11,11,0.12)]"
        >
          {results.length === 0 && (
            <li className="px-3 py-2 text-[13px] text-ink-2">{failed ? "Place search is unavailable." : "No matches in Singapore."}</li>
          )}
          {results.map((p, i) => (
            <li
              key={`${p.name}-${p.lat}-${p.lon}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(p);
              }}
              onMouseEnter={() => setActive(i)}
              className={`cursor-pointer px-3 py-2 ${i === active ? "bg-surface-2" : ""}`}
            >
              <div className="truncate text-sm text-ink">{p.name}</div>
              {p.address && p.address !== p.name && <div className="truncate text-xs text-ink-2">{p.address}</div>}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-1.5 text-xs text-ink-2 tnum">
        {Math.abs(value.lat).toFixed(4)}° {value.lat >= 0 ? "N" : "S"}, {Math.abs(value.lon).toFixed(4)}° {value.lon >= 0 ? "E" : "W"}
        <span className="text-muted">, searched with OneMap</span>
      </p>
    </div>
  );
}
