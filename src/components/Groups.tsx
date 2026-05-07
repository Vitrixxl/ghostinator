import { FormEvent, useState } from "react";
import * as api from "../lib/api";
import { encryptWithKey, generateGroupKey, saveGroupKey, shortHash } from "../lib/crypto";
import type { Group, Identity } from "../types";
import { CopyBox, Empty, Sigil, Stamp } from "./ui";

export function Groups({
  identity,
  groups,
  onCreate,
}: {
  identity: Identity;
  groups: Group[];
  onCreate: (group: Group) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <section>
      <header className="flex flex-wrap items-end justify-between gap-3 border-b-[3px] border-double border-ink pb-3">
        <div>
          <p className="kicker">Salons fermés</p>
          <h2 className="masthead text-5xl">Cercles</h2>
          <p className="marginalia mt-1">
            Métadonnées publiques. Contenu chiffré sous une clé symétrique partagée hors-bande.
          </p>
        </div>
        <button className="btn-stamp" onClick={() => setOpen(true)}>＋ Fonder un cercle</button>
      </header>

      {groups.length === 0 ? (
        <div className="mt-8">
          <Empty title="Aucun cercle ouvert" hint="Fondez le premier cercle de ce bureau." />
        </div>
      ) : (
        <div className="mt-7 grid gap-5 md:grid-cols-2 xl:grid-cols-2">
          {groups.map((group) => (
            <GroupCard key={group.id} group={group} self={group.ownerUsername === identity.username} />
          ))}
        </div>
      )}

      {open ? (
        <CreateModal
          identity={identity}
          onClose={() => setOpen(false)}
          onCreate={(group) => {
            onCreate(group);
            setOpen(false);
          }}
        />
      ) : null}
    </section>
  );
}

function GroupCard({ group, self }: { group: Group; self: boolean }) {
  return (
    <article className="leaf flex flex-col p-5">
      <header className="flex items-start justify-between gap-3 border-b border-rule pb-3">
        <div className="flex items-center gap-3">
          <Sigil text={group.name} size={44} tone="moss" />
          <div>
            <p className="kicker">Cercle №{group.id.slice(0, 6)}</p>
            <h3 className="font-display text-2xl font-bold leading-tight">{group.name}</h3>
          </div>
        </div>
        {self ? <Stamp tone="stamp" rotate={6}>Fondateur</Stamp> : null}
      </header>
      <p className="mt-3 font-serif text-base leading-7 text-graphite">{group.topic}</p>
      <footer className="mt-5 flex items-center justify-between border-t border-rule pt-3 font-mono text-[10.5px] uppercase tracking-ultra text-ash">
        <span>{group.memberCount} membre{group.memberCount > 1 ? "s" : ""}</span>
        <span>fondé par @{group.ownerUsername}</span>
      </footer>
      <p className="mt-2 truncate font-mono text-[10px] text-chalk">
        intro cipher {shortHash(group.encryptedIntro.cipher, 6)}
      </p>
    </article>
  );
}

function CreateModal({
  identity,
  onClose,
  onCreate,
}: {
  identity: Identity;
  onClose: () => void;
  onCreate: (group: Group) => void;
}) {
  const [name, setName] = useState("");
  const [topic, setTopic] = useState("");
  const [intro, setIntro] = useState("");
  const [created, setCreated] = useState<{ group: Group; key: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || !topic.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const key = await generateGroupKey();
      const encryptedIntro = await encryptWithKey(
        key,
        intro.trim() || `Bienvenue dans ${name.trim()}.`,
      );
      const group = await api.createGroup({
        ownerHash: identity.publicHash,
        ownerUsername: identity.username,
        name: name.trim().slice(0, 80),
        topic: topic.trim().slice(0, 180),
        encryptedIntro,
      });
      saveGroupKey(group.id, key);
      setCreated({ group, key });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-ink/40 p-4 backdrop-blur-sm" role="dialog">
      <div className="leaf relative w-full max-w-xl p-6 animate-rise-in">
        <button
          className="absolute right-4 top-3 font-mono text-[11px] font-bold uppercase tracking-ultra text-ash hover:text-stamp"
          onClick={onClose}
        >
          ✕ Fermer
        </button>
        {!created ? (
          <form onSubmit={submit}>
            <p className="kicker">Fondation</p>
            <h3 className="masthead text-4xl">Nouveau cercle</h3>
            <p className="marginalia mt-1">
              Le serveur retient le nom et le sujet. L'intro et le contenu utiliseront la clé symétrique générée.
            </p>
            <div className="mt-5 space-y-4">
              <div>
                <label className="kicker mb-1 block">Nom du cercle</label>
                <input
                  className="field"
                  placeholder="Cercle des copistes"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  maxLength={80}
                  autoFocus
                />
              </div>
              <div>
                <label className="kicker mb-1 block">Sujet public (métadonnée)</label>
                <textarea
                  className="field-block min-h-[80px]"
                  placeholder="De quoi parle ce cercle ?"
                  value={topic}
                  onChange={(event) => setTopic(event.target.value)}
                  maxLength={180}
                />
              </div>
              <div>
                <label className="kicker mb-1 block">Note d'introduction (chiffrée)</label>
                <textarea
                  className="field-block min-h-[80px]"
                  placeholder="Mot d'accueil, lu seulement par les membres."
                  value={intro}
                  onChange={(event) => setIntro(event.target.value)}
                />
              </div>
            </div>
            {error ? (
              <p className="mt-3 font-mono text-[11px] uppercase tracking-ultra text-stamp">{error}</p>
            ) : null}
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <button className="btn-stamp" disabled={!name.trim() || !topic.trim() || submitting}>
                {submitting ? "Sceller…" : "Fonder"}
              </button>
              <button type="button" className="btn-ghost" onClick={onClose}>
                Annuler
              </button>
            </div>
          </form>
        ) : (
          <div>
            <Stamp tone="stamp" rotate={-4}>Cercle fondé</Stamp>
            <h3 className="masthead mt-4 text-4xl">{created.group.name}</h3>
            <p className="marginalia mt-1">
              Sa clé symétrique est conservée localement. Pour faire entrer un membre, transmettez-la hors-bande.
            </p>
            <div className="mt-5">
              <CopyBox label="Clé symétrique du cercle (base64)" value={created.key} multiline reveal />
            </div>
            <button className="btn mt-5" onClick={() => onCreate(created.group)}>
              Entrer dans le cercle
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
