"use client";

import React, { useId } from "react";
import type { Option } from "@/engine";
import { cx } from "@/lib/utils";

const FIELD =
  "w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 " +
  "placeholder:text-zinc-600 focus:border-indigo-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40 " +
  "disabled:cursor-not-allowed disabled:opacity-50";

export function Section({
  icon,
  title,
  hint,
  children,
  right,
}: {
  icon: React.ReactNode;
  title: string;
  hint?: string;
  children: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <section className="space-y-4 rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
            <span className="text-indigo-400" aria-hidden>
              {icon}
            </span>
            {title}
          </h2>
          {hint && <p className="mt-1 text-xs text-zinc-500">{hint}</p>}
        </div>
        {right}
      </header>
      {children}
    </section>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: (id: string) => React.ReactNode;
}) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-xs font-medium text-zinc-400">
        {label}
      </label>
      {children(id)}
      {error ? (
        <p className="mt-1 text-xs text-red-400" role="alert">
          {error}
        </p>
      ) : (
        hint && <p className="mt-1 text-[11px] text-zinc-500">{hint}</p>
      )}
    </div>
  );
}

export function TextInput({
  value,
  onChange,
  ...rest
}: { value: string; onChange: (v: string) => void } & Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange" | "value">) {
  return <input {...rest} value={value} onChange={(e) => onChange(e.target.value)} className={cx(FIELD, rest.className)} />;
}

export function NumberInput({
  value,
  onChange,
  ...rest
}: { value: number; onChange: (v: number) => void } & Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange" | "value">) {
  return (
    <input
      {...rest}
      type="number"
      value={Number.isNaN(value) ? "" : value}
      onChange={(e) => onChange(e.target.value === "" ? Number.NaN : Number(e.target.value))}
      className={cx(FIELD, rest.className)}
    />
  );
}

export function Select({
  value,
  onChange,
  options,
  ...rest
}: {
  value: string;
  onChange: (v: string) => void;
  options: ReadonlyArray<Pick<Option, "id" | "label"> & { available?: boolean }>;
} & Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "onChange" | "value">) {
  return (
    <select {...rest} value={value} onChange={(e) => onChange(e.target.value)} className={cx(FIELD, "pr-8", rest.className)}>
      {options.map((o) => (
        <option key={o.id} value={o.id} disabled={o.available === false}>
          {o.label}
          {o.available === false ? " (coming soon)" : ""}
        </option>
      ))}
    </select>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex items-start gap-3">
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx(
          "relative mt-0.5 h-5 w-9 shrink-0 rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60 disabled:cursor-not-allowed disabled:opacity-50",
          checked ? "border-indigo-500 bg-indigo-600" : "border-zinc-700 bg-zinc-800",
        )}
      >
        <span
          className={cx(
            "absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white transition-all",
            checked ? "left-[18px]" : "left-0.5",
          )}
        />
      </button>
      <label htmlFor={id} className="cursor-pointer select-none text-sm text-zinc-300">
        {label}
        {hint && <span className="block text-[11px] text-zinc-500">{hint}</span>}
      </label>
    </div>
  );
}

export function Badge({ tone, children }: { tone: "ok" | "warn" | "bad" | "info"; children: React.ReactNode }) {
  const tones = {
    ok: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
    warn: "border-amber-500/30 bg-amber-500/10 text-amber-300",
    bad: "border-red-500/30 bg-red-500/10 text-red-300",
    info: "border-indigo-500/30 bg-indigo-500/10 text-indigo-300",
  };
  return <span className={cx("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs", tones[tone])}>{children}</span>;
}

export function Button({
  variant = "secondary",
  className,
  ...rest
}: { variant?: "primary" | "secondary" | "ghost" } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const variants = {
    primary: "bg-indigo-600 text-white hover:bg-indigo-500 border-indigo-500",
    secondary: "bg-zinc-900 text-zinc-200 hover:bg-zinc-800 border-zinc-700",
    ghost: "bg-transparent text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/60 border-transparent",
  };
  return (
    <button
      type="button"
      {...rest}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60 disabled:cursor-not-allowed disabled:opacity-50",
        variants[variant],
        className,
      )}
    />
  );
}
