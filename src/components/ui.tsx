import type { CSSProperties, PropsWithChildren, ReactNode } from "react";

export function Sigil({
  text,
  size = 44,
  tone = "ink",
}: {
  text: string;
  size?: number;
  tone?: "ink" | "stamp" | "cipher" | "moss";
}) {
  const initials = text
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(0, 2)
    .toUpperCase() || "??";
  const fontSize = Math.round(size * 0.42);
  const colorClass: Record<string, string> = {
    ink: "border-ink text-ink bg-cream",
    stamp: "border-stamp text-stamp bg-stamp/5",
    cipher: "border-cipher text-cipher bg-cipher/5",
    moss: "border-moss text-moss bg-moss/5",
  };
  return (
    <span
      className={`sigil ${colorClass[tone]}`}
      style={{ width: size, height: size, fontSize, lineHeight: 1 }}
      aria-hidden
    >
      {initials}
    </span>
  );
}

export function Stamp({
  label,
  tone = "stamp",
  rotate = -7,
  children,
}: PropsWithChildren<{ label?: string; tone?: "stamp" | "cipher" | "ink"; rotate?: number }>) {
  const palette: Record<string, string> = {
    stamp: "border-stamp text-stamp bg-stamp/5",
    cipher: "border-cipher text-cipher bg-cipher/5",
    ink: "border-ink text-ink bg-ink/5",
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 border-[2.5px] px-2 py-1 font-mono text-[10px] font-black uppercase tracking-ultra ${palette[tone]}`}
      style={{ transform: `rotate(${rotate}deg)` }}
    >
      {children ?? label}
    </span>
  );
}

export function Fleuron({ glyph = "❦" }: { glyph?: string }) {
  return (
    <div className="fleuron font-display text-lg italic" aria-hidden>
      <span>{glyph}</span>
    </div>
  );
}

export function Field({
  label,
  hint,
  required,
  error,
  children,
}: PropsWithChildren<{ label: string; hint?: string; required?: boolean; error?: string | null }>) {
  return (
    <label className="block">
      <span className="kicker mb-1 flex items-center justify-between">
        <span className="flex items-center gap-2">
          <span>{label}</span>
          {required ? <span className="text-stamp">*</span> : null}
        </span>
        {hint ? <span className="font-mono text-[10px] text-smoke normal-case tracking-widest">{hint}</span> : null}
      </span>
      {children}
      {error ? (
        <span className="mt-1 block font-mono text-[10.5px] text-stamp">{error}</span>
      ) : null}
    </label>
  );
}

export function CopyBox({
  label,
  value,
  multiline,
  reveal,
}: {
  label: string;
  value: string;
  multiline?: boolean;
  reveal?: boolean;
}) {
  return (
    <div className="leaf relative p-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="kicker">{label}</span>
        <button
          type="button"
          className="font-mono text-[10px] font-extrabold uppercase tracking-ultra text-stamp underline-offset-4 hover:underline"
          onClick={() => navigator.clipboard.writeText(value)}
        >
          ⎘ Copier
        </button>
      </div>
      {multiline ? (
        <pre className="max-h-44 overflow-auto whitespace-pre-wrap break-all font-mono text-[11.5px] leading-5 text-graphite">
          {reveal ? value : value.replace(/[a-zA-Z0-9+/=]/g, "•")}
        </pre>
      ) : (
        <code className="block break-all font-mono text-[12px] leading-5 text-graphite">
          {reveal ? value : value.replace(/[a-zA-Z0-9+/=]/g, "•")}
        </code>
      )}
    </div>
  );
}

export function Masthead({
  size = "lg",
  className = "",
  italic = false,
}: {
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
  italic?: boolean;
}) {
  const map: Record<string, string> = {
    sm: "text-3xl",
    md: "text-5xl",
    lg: "text-7xl",
    xl: "text-[clamp(3rem,9vw,7.5rem)]",
  };
  return (
    <h1
      className={`masthead ${map[size]} ${italic ? "italic" : ""} ${className}`}
      style={{ letterSpacing: size === "xl" ? "-0.025em" : "-0.015em" }}
    >
      GHOST<span className="text-stamp">in</span>ATOR
    </h1>
  );
}

export function MetaRow({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 md:grid-cols-3">
      {items.map((item) => (
        <div key={item.label}>
          <dt className="kicker">{item.label}</dt>
          <dd className="mt-0.5 font-mono text-[12px] text-graphite">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Spinner({ label = "ATTENTE", style }: { label?: string; style?: CSSProperties }) {
  return (
    <span
      className="inline-flex items-center gap-2 font-mono text-[10.5px] font-bold uppercase tracking-ultra text-ash"
      style={style}
    >
      <span className="inline-block h-2 w-2 animate-blink bg-stamp" />
      {label}
    </span>
  );
}

export function Empty({ title, hint, action }: { title: string; hint: string; action?: ReactNode }) {
  return (
    <div className="leaf p-8 text-center">
      <Fleuron />
      <p className="mt-4 font-display text-2xl italic text-graphite">{title}</p>
      <p className="marginalia mt-2">{hint}</p>
      {action ? <div className="mt-5 flex justify-center">{action}</div> : null}
    </div>
  );
}
