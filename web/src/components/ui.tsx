"use client";

import type { ReactNode } from "react";
import type { Level } from "@/lib/risk";

export const STATUS_COLOR: Record<Level, string> = { Low: "var(--good)", Medium: "var(--warning)", High: "var(--critical)" };
const STATUS_WASH: Record<Level, string> = { Low: "var(--good-wash)", Medium: "var(--warning-wash)", High: "var(--critical-wash)" };

// status always carries a shape as well as a colour: circle-check, triangle, octagon
export function StatusIcon({ level, size = 16 }: { level: Level; size?: number }) {
  const c = STATUS_COLOR[level];
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden className="shrink-0">
      {level === "Low" && (
        <>
          <circle cx="8" cy="8" r="7.5" fill={c} />
          <path d="M4.6 8.2l2.2 2.2 4.6-4.7" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round"
            strokeLinejoin="round" />
        </>
      )}
      {level === "Medium" && (
        <>
          <path d="M8 .9c.5 0 .9.3 1.2.7l6.4 11.2c.5.9-.1 2-1.2 2H1.6c-1.1 0-1.7-1.1-1.2-2L6.8 1.6C7.1 1.2 7.5.9 8 .9z"
            fill={c} />
          <path d="M8 5.2v4.3" stroke="#0b0b0b" strokeWidth="1.7" strokeLinecap="round" />
          <circle cx="8" cy="12" r="1" fill="#0b0b0b" />
        </>
      )}
      {level === "High" && (
        <>
          <path d="M5.1.5h5.8l4.6 4.6v5.8l-4.6 4.6H5.1L.5 10.9V5.1z" fill={c} />
          <path d="M5.4 5.4l5.2 5.2M10.6 5.4l-5.2 5.2" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
        </>
      )}
    </svg>
  );
}

// a level in a table cell whose column names the factor; the icon's shape carries the level without colour
export function LevelMark({ level, name }: { level: Level | null; name: string }) {
  if (!level) return <span className="text-muted" title={`${name}: not outside`}>–</span>;
  return (
    <span className="inline-flex" title={`${name}: ${level}`}>
      <StatusIcon level={level} />
      <span className="sr-only">{`${name} ${level}`}</span>
    </span>
  );
}

export const FACTOR_COLUMNS = ["Air", "Heat", "UV", "Rain"] as const;

export function LevelLegend() {
  return (
    <span className="inline-flex flex-wrap items-center gap-x-4 gap-y-1">
      {(["Low", "Medium", "High"] as Level[]).map((l) => (
        <span key={l} className="inline-flex items-center gap-1.5"><StatusIcon level={l} size={14} />{l}</span>
      ))}
    </span>
  );
}

export function StatusPill({ level, size = "md", children }: { level: Level; size?: "sm" | "md"; children?: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full font-medium text-ink whitespace-nowrap ${
        size === "sm" ? "h-6 pl-1.5 pr-2.5 text-[13px]" : "h-7 pl-2 pr-3 text-sm"}`}
      style={{ background: STATUS_WASH[level] }}
    >
      <StatusIcon level={level} size={size === "sm" ? 14 : 16} />
      {children ?? level}
    </span>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-line bg-surface shadow-[var(--shadow)] ${className}`}>{children}</section>
  );
}

export function CardHeader({ title, subtitle, action }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 px-5 pt-4 pb-3">
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold leading-6 text-ink">{title}</h2>
        {subtitle && <p className="mt-0.5 text-[13px] leading-5 text-ink-2">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function TextButton({ onClick, children, pressed }: { onClick: () => void; children: ReactNode; pressed?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={pressed}
      className="h-7 rounded-md border border-line px-2.5 text-[13px] font-medium text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      {children}
    </button>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label }: {
  value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="grid h-9 auto-cols-fr grid-flow-col rounded-lg bg-surface-2 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={`rounded-md text-[13px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-accent ${
            value === o.value ? "bg-surface text-ink shadow-[0_1px_2px_rgba(11,11,11,0.08)] ring-1 ring-line" : "text-ink-2 hover:text-ink"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Field({ label, htmlFor, hint, children, className = "" }: {
  label: string; htmlFor?: string; hint?: ReactNode; children: ReactNode; className?: string;
}) {
  return (
    <div className={className}>
      <label htmlFor={htmlFor} className="mb-1.5 block text-[13px] font-medium text-ink-2">{label}</label>
      {children}
      {hint && <p className="mt-1.5 text-xs leading-[18px] text-ink-2">{hint}</p>}
    </div>
  );
}

export const inputClass =
  "h-9 w-full rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink placeholder:text-muted transition-colors hover:border-axis focus:border-accent focus:outline-none focus:ring-3 focus:ring-accent/20";

export function SuffixInput({ suffix, className = "", ...props }: React.InputHTMLAttributes<HTMLInputElement> & { suffix: string }) {
  return (
    <div className="relative">
      <input {...props} className={`${inputClass} tnum pr-12 ${className}`} />
      <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[13px] text-muted">{suffix}</span>
    </div>
  );
}

export function Spinner({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" className="spin" aria-hidden>
      <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
      <path d="M14.5 8A6.5 6.5 0 0 0 8 1.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
