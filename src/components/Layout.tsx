import { ReactNode } from "react";
import type { Conversation, Health, Identity } from "../types";
import { shortHash } from "../lib/crypto";
import { Masthead, Sigil, Spinner, Stamp } from "./ui";

export type View = "feed" | "chat" | "groups" | "dossier";

const NAV: { id: View; label: string; tag: string }[] = [
  { id: "feed", label: "Feed", tag: "Dispatches publics" },
  { id: "chat", label: "Chats", tag: "Correspondance privée" },
  { id: "groups", label: "Groupes", tag: "Cercles fermés" },
  { id: "dossier", label: "Dossier", tag: "Vos clés" },
];

export function Shell({
  view,
  navigate,
  identity,
  conversations,
  health,
  rightRail,
  children,
}: {
  view: View;
  navigate: (v: View) => void;
  identity: Identity;
  conversations: Conversation[];
  health: Health | null;
  rightRail?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="relative mx-auto grid min-h-screen w-full max-w-[1400px] grid-cols-1 lg:grid-cols-[280px_minmax(0,1fr)] xl:grid-cols-[280px_minmax(0,1fr)_340px]">
      <SideRail
        view={view}
        navigate={navigate}
        identity={identity}
        conversations={conversations}
        health={health}
      />
      <main className="border-x border-rule bg-paper px-5 pb-32 pt-6 md:px-10 lg:pb-12">
        {children}
      </main>
      <aside className="hidden border-r border-rule bg-paper px-6 pb-12 pt-8 xl:block">
        {rightRail}
      </aside>
      <BottomNav view={view} navigate={navigate} />
    </div>
  );
}

function SideRail({
  view,
  navigate,
  identity,
  conversations,
  health,
}: {
  view: View;
  navigate: (v: View) => void;
  identity: Identity;
  conversations: Conversation[];
  health: Health | null;
}) {
  return (
    <aside className="hidden flex-col gap-6 border-r border-rule bg-paper px-6 pb-10 pt-7 lg:flex">
      <div className="border-b-[3px] border-double border-ink pb-4">
        <Masthead size="md" />
        <p className="mt-1 font-mono text-[10.5px] uppercase tracking-ultra text-ash">
          Bureau · Édition Vol. I
        </p>
        <p className="font-serif text-sm italic text-graphite">Correspondance chiffrée — Fait à la main.</p>
      </div>

      <section className="leaf p-4">
        <div className="flex items-center gap-3">
          <Sigil text={identity.username} size={48} tone="stamp" />
          <div className="min-w-0">
            <p className="kicker">Agent</p>
            <p className="truncate font-display text-2xl font-bold">@{identity.username}</p>
            <p className="mt-0.5 font-mono text-[11px] text-ash">
              {shortHash(identity.publicHash, 6)}
            </p>
          </div>
        </div>
        <div className="mt-3 flex items-center justify-between border-t border-rule pt-3">
          <Stamp tone="cipher" rotate={-2}>en service</Stamp>
          <button
            className="font-mono text-[10.5px] font-bold uppercase tracking-ultra text-stamp hover:underline"
            onClick={() => navigate("dossier")}
          >
            Dossier →
          </button>
        </div>
      </section>

      <nav>
        <p className="kicker mb-2">Sections</p>
        <ul className="space-y-1">
          {NAV.map((item) => {
            const active = view === item.id;
            return (
              <li key={item.id}>
                <button
                  className={`group flex w-full items-baseline justify-between border-l-[3px] py-2 pl-3 pr-2 text-left transition ${
                    active
                      ? "border-stamp bg-stamp/5"
                      : "border-transparent hover:border-ink hover:bg-cream"
                  }`}
                  onClick={() => navigate(item.id)}
                >
                  <span
                    className={`font-display text-2xl font-bold leading-none ${
                      active ? "text-stamp" : "text-ink"
                    }`}
                  >
                    {item.label}
                  </span>
                  <span className="dispatch-no">{item.tag}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <p className="kicker">Plis récents</p>
          <span className="dispatch-no">{conversations.length}</span>
        </div>
        <ul className="space-y-2">
          {conversations.length === 0 ? (
            <li className="border border-dashed border-rule p-3 font-serif text-sm italic text-smoke">
              Pas encore de pli reçu.
            </li>
          ) : (
            conversations.slice(0, 4).map((c) => (
              <li key={c.id}>
                <button
                  className="flex w-full items-center gap-3 border border-rule bg-cream px-3 py-2 text-left hover:border-ink"
                  onClick={() => navigate("chat")}
                >
                  <Sigil text={c.peerUsername} size={32} tone="ink" />
                  <div className="min-w-0">
                    <p className="truncate font-display text-base font-semibold leading-tight">
                      @{c.peerUsername}
                    </p>
                    <p className="font-mono text-[10.5px] text-ash">
                      {c.messages.length} blob{c.messages.length === 1 ? "" : "s"}
                    </p>
                  </div>
                </button>
              </li>
            ))
          )}
        </ul>
      </section>

      <section className="mt-auto border-t border-rule pt-4">
        <div className="space-y-1.5 font-mono text-[10.5px] uppercase tracking-widest text-ash">
          <p className="flex items-center justify-between">
            <span>Edge</span>
            <span className="text-graphite">{health?.edge || "…"}</span>
          </p>
          <p className="flex items-center justify-between">
            <span>BDD</span>
            <span className="text-graphite">{health?.db || "…"}</span>
          </p>
          <p className="flex items-center justify-between">
            <span>WebCrypto</span>
            <Spinner label="actif" />
          </p>
        </div>
      </section>
    </aside>
  );
}

function BottomNav({ view, navigate }: { view: View; navigate: (v: View) => void }) {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t-2 border-ink bg-cream/95 backdrop-blur lg:hidden">
      {NAV.map((item) => {
        const active = view === item.id;
        return (
          <button
            key={item.id}
            className={`relative flex flex-col items-center justify-center gap-0.5 border-r border-rule py-2.5 last:border-r-0 ${
              active ? "bg-ink text-cream" : "text-ink"
            }`}
            onClick={() => navigate(item.id)}
          >
            <span className="font-display text-base font-bold leading-tight">{item.label}</span>
            <span
              className={`font-mono text-[8.5px] uppercase tracking-ultra ${
                active ? "text-cream/80" : "text-ash"
              }`}
            >
              {item.tag.split(" ")[0]}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
