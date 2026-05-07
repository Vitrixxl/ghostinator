import { FormEvent, useEffect, useState } from "react";
import * as api from "../lib/api";
import { shortHash } from "../lib/crypto";
import type { Identity, User } from "../types";
import { Sigil, Stamp } from "./ui";

export function SearchPanel({
  identity,
  onOpen,
}: {
  identity: Identity;
  onOpen: (user: User) => void | Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<User[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const timeout = setTimeout(async () => {
      try {
        const found = await api.searchUsers(query.trim(), identity.publicHash);
        if (!cancelled) setResults(found);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Erreur");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 220);
    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [query, identity.publicHash]);

  function submit(event: FormEvent) {
    event.preventDefault();
  }

  async function open(user: User) {
    setOpening(user.publicHash);
    try {
      await onOpen(user);
    } finally {
      setOpening(null);
    }
  }

  return (
    <section>
      <header className="border-b-[3px] border-double border-ink pb-2">
        <p className="kicker">Directoire</p>
        <h3 className="masthead text-3xl">Trouver un agent</h3>
        <p className="marginalia mt-1">Cherchez par alias public.</p>
      </header>

      <form onSubmit={submit} className="mt-4">
        <div className="flex items-center gap-2 border-2 border-ink bg-cream px-3 py-2">
          <span className="font-mono text-[12px] font-extrabold uppercase tracking-ultra text-ash">
            ⌕
          </span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="alias public"
            className="w-full bg-transparent font-mono text-[13px] outline-none"
            spellCheck={false}
            autoComplete="off"
          />
          {loading ? (
            <span className="inline-block h-2 w-2 animate-blink bg-stamp" aria-label="loading" />
          ) : null}
        </div>
      </form>

      <div className="mt-5">
        {error ? (
          <p className="border border-stamp bg-stamp/5 p-3 font-mono text-[11px] uppercase tracking-ultra text-stamp">
            {error}
          </p>
        ) : null}

        {!query.trim() ? (
          <p className="font-serif text-sm italic text-smoke">
            Saisissez un nom pour parcourir le directoire public.
          </p>
        ) : null}

        {query.trim() && !loading && results.length === 0 ? (
          <p className="font-serif text-sm italic text-smoke">Aucun agent ne porte ce nom.</p>
        ) : null}

        <ul className="mt-2 space-y-2">
          {results.map((user) => (
            <li key={user.publicHash}>
              <button
                onClick={() => open(user)}
                disabled={opening === user.publicHash}
                className="flex w-full items-center gap-3 border border-rule bg-cream px-3 py-2.5 text-left transition hover:border-ink"
              >
                <Sigil text={user.username} size={40} tone="cipher" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-display text-lg font-semibold leading-tight">
                    @{user.username}
                  </p>
                  <p className="font-mono text-[10.5px] text-ash">
                    {shortHash(user.publicHash, 8)}
                  </p>
                </div>
                <span className="dispatch-no text-stamp">
                  {opening === user.publicHash ? "ouvre…" : "ouvrir →"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-8 border-t border-rule pt-4">
        <Stamp tone="cipher" rotate={-3}>Note</Stamp>
        <p className="marginalia mt-2">
          Le directoire ne révèle qu'alias et clé publique. Aucune métadonnée privée n'est exposée.
        </p>
      </div>
    </section>
  );
}
