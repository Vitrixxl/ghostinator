import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import * as api from "../lib/api";
import {
  decryptWithKey,
  encodeGroupInvite,
  encryptForPeer,
  encryptWithKey,
  generateGroupKey,
  loadGroupKey,
  saveGroupKey,
  shortHash,
} from "../lib/crypto";
import type { Conversation, Group, GroupMessage, Identity, User } from "../types";
import { CopyBox, Empty, Sigil, Stamp } from "./ui";

export function Groups({
  identity,
  groups,
  joinedGroupIds,
  conversations,
  onCreate,
  onJoined,
  onGroupMessage,
  onSendDmInvite,
}: {
  identity: Identity;
  groups: Group[];
  joinedGroupIds: Set<string>;
  conversations: Conversation[];
  onCreate: (group: Group) => void;
  onJoined: (groupId: string) => void;
  onGroupMessage: (groupId: string, message: GroupMessage) => void;
  onSendDmInvite: (peerHash: string, ciphertext: { iv: string; cipher: string }) => Promise<void>;
}) {
  const [createOpen, setCreateOpen] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);
  const [discoverOpen, setDiscoverOpen] = useState(false);
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);

  const activeGroup = useMemo(
    () => groups.find((g) => g.id === activeGroupId) || null,
    [groups, activeGroupId],
  );

  const myGroups = useMemo(
    () => groups.filter((g) => joinedGroupIds.has(g.id)),
    [groups, joinedGroupIds],
  );

  if (activeGroup) {
    return (
      <GroupThread
        identity={identity}
        group={activeGroup}
        conversations={conversations}
        onBack={() => setActiveGroupId(null)}
        onMessage={onGroupMessage}
        onSendDmInvite={onSendDmInvite}
      />
    );
  }

  return (
    <section>
      <header className="flex flex-wrap items-end justify-between gap-3 border-b-[3px] border-double border-ink pb-3">
        <div className="min-w-0 flex-1">
          <p className="kicker">Salons fermés</p>
          <h2 className="masthead text-3xl sm:text-4xl md:text-5xl">Cercles</h2>
          <p className="marginalia mt-1">
            Vos cercles. Contenu chiffré sous une clé symétrique locale, jamais partagée au serveur.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <button
            className="btn-ghost px-3 py-2 text-[10px] sm:text-[11px]"
            onClick={() => setDiscoverOpen(true)}
          >
            ⌕ Découvrir
          </button>
          <button
            className="btn-ghost px-3 py-2 text-[10px] sm:text-[11px]"
            onClick={() => setJoinOpen(true)}
          >
            Rejoindre
          </button>
          <button
            className="btn-stamp px-3 py-2 text-[10px] sm:text-[11px]"
            onClick={() => setCreateOpen(true)}
          >
            + Fonder
          </button>
        </div>
      </header>

      {myGroups.length === 0 ? (
        <div className="mt-6 sm:mt-8">
          <Empty
            title="Vous n'êtes dans aucun cercle"
            hint="Fondez-en un, rejoignez via une clé partagée hors-bande, ou découvrez ceux qui existent."
          />
        </div>
      ) : (
        <div className="mt-5 grid gap-4 sm:mt-7 sm:gap-5 md:grid-cols-2">
          {myGroups.map((group) => (
            <GroupCard
              key={group.id}
              group={group}
              self={group.ownerHash === identity.publicHash}
              onOpen={() => setActiveGroupId(group.id)}
            />
          ))}
        </div>
      )}

      {createOpen ? (
        <CreateModal
          identity={identity}
          onClose={() => setCreateOpen(false)}
          onCreate={(group) => {
            onCreate(group);
            setCreateOpen(false);
            setActiveGroupId(group.id);
          }}
        />
      ) : null}

      {joinOpen ? (
        <JoinModal
          groups={groups}
          onClose={() => setJoinOpen(false)}
          onJoined={(groupId) => {
            onJoined(groupId);
            setJoinOpen(false);
            setActiveGroupId(groupId);
          }}
        />
      ) : null}

      {discoverOpen ? (
        <DiscoverModal
          groups={groups}
          joinedGroupIds={joinedGroupIds}
          onClose={() => setDiscoverOpen(false)}
        />
      ) : null}
    </section>
  );
}

function GroupCard({
  group,
  self,
  onOpen,
}: {
  group: Group;
  self: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="leaf flex w-full flex-col p-4 text-left transition hover:border-ink sm:p-5"
    >
      <header className="flex items-start justify-between gap-2 border-b border-rule pb-2 sm:gap-3 sm:pb-3">
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          <Sigil text={group.name} size={36} tone="moss" />
          <div className="min-w-0">
            <p className="kicker truncate">Cercle №{group.id.slice(0, 6)}</p>
            <h3 className="break-words font-display text-xl font-bold leading-tight sm:text-2xl">
              {group.name}
            </h3>
          </div>
        </div>
        {self ? (
          <span className="shrink-0">
            <Stamp tone="stamp" rotate={6}>Fondateur</Stamp>
          </span>
        ) : null}
      </header>
      <p className="mt-3 break-words font-serif text-[15px] leading-6 text-graphite sm:text-base sm:leading-7">
        {group.topic}
      </p>
      <footer className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-rule pt-3 font-mono text-[10px] uppercase tracking-ultra text-ash sm:mt-5 sm:text-[10.5px]">
        <span>
          {group.messages?.length || 0} message{(group.messages?.length || 0) === 1 ? "" : "s"}
        </span>
        <span className="truncate">par @{group.ownerUsername}</span>
      </footer>
    </button>
  );
}

function GroupThread({
  identity,
  group,
  conversations,
  onBack,
  onMessage,
  onSendDmInvite,
}: {
  identity: Identity;
  group: Group;
  conversations: Conversation[];
  onBack: () => void;
  onMessage: (groupId: string, message: GroupMessage) => void;
  onSendDmInvite: (peerHash: string, ciphertext: { iv: string; cipher: string }) => Promise<void>;
}) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [groupKey, setGroupKey] = useState<string | null>(null);
  const [decrypted, setDecrypted] = useState<Record<string, string | null>>({});
  const [inviteOpen, setInviteOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const isOwner = group.ownerHash === identity.publicHash;

  /* Récupère la clé symétrique du cercle stockée localement (IndexedDB). */
  useEffect(() => {
    let cancelled = false;
    loadGroupKey(group.id).then((key) => {
      if (!cancelled) setGroupKey(key);
    });
    return () => {
      cancelled = true;
    };
  }, [group.id]);

  /* Déchiffre tous les messages quand on a la clé. */
  useEffect(() => {
    if (!groupKey) return;
    let cancelled = false;
    async function decryptAll() {
      const out: Record<string, string | null> = {};
      for (const message of group.messages) {
        try {
          out[message.id] = await decryptWithKey(groupKey!, message.encrypted);
        } catch {
          out[message.id] = null;
        }
      }
      if (!cancelled) setDecrypted(out);
    }
    decryptAll();
    return () => {
      cancelled = true;
    };
  }, [groupKey, group.messages]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [group.messages.length]);

  async function send(event: FormEvent) {
    event.preventDefault();
    if (!draft.trim() || sending || !groupKey) return;
    setSending(true);
    setError(null);
    try {
      const encrypted = await encryptWithKey(groupKey, draft.trim());
      const message = await api.createGroupMessage(group.id, {
        authorHash: identity.publicHash,
        authorUsername: identity.username,
        encrypted,
      });
      onMessage(group.id, message);
      setDraft("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setSending(false);
    }
  }

  if (!groupKey) {
    return (
      <article className="leaf p-5 sm:p-6">
        <div className="flex items-center gap-3 border-b border-rule pb-3">
          <button className="btn-icon" aria-label="Retour" onClick={onBack}>
            ←
          </button>
          <div className="min-w-0">
            <p className="kicker">Cercle</p>
            <h2 className="truncate font-display text-2xl font-bold leading-none sm:text-3xl">
              {group.name}
            </h2>
          </div>
        </div>
        <Stamp tone="stamp" rotate={-3}>Clé manquante</Stamp>
        <p className="marginalia mt-3">
          Vous n'avez pas la clé symétrique de ce cercle dans ce navigateur. Demandez-la
          au fondateur (transmise hors-bande) puis rejoignez via « Rejoindre » dans la
          liste des cercles.
        </p>
      </article>
    );
  }

  return (
    <article className="leaf flex h-[calc(100vh-180px)] flex-col md:h-[calc(100vh-160px)]">
      <header className="flex items-center justify-between gap-2 border-b-[2px] border-ink p-3 sm:gap-3 sm:p-4 md:p-5">
        <button className="btn-icon shrink-0" aria-label="Retour" onClick={onBack}>
          ←
        </button>
        <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
          <Sigil text={group.name} size={40} tone="moss" />
          <div className="min-w-0">
            <p className="kicker">Cercle</p>
            <h2 className="truncate font-display text-xl font-bold leading-none sm:text-2xl md:text-3xl">
              {group.name}
            </h2>
            <p className="mt-1 truncate font-mono text-[10.5px] text-ash">
              clé locale {shortHash(groupKey, 4)}
            </p>
          </div>
        </div>
        {isOwner ? (
          <button
            type="button"
            className="btn-ghost shrink-0 px-2.5 py-1.5 text-[10px] sm:px-3 sm:py-2 sm:text-[11px]"
            onClick={() => setInviteOpen(true)}
          >
            + Inviter
          </button>
        ) : null}
      </header>

      <div
        ref={scrollRef}
        className="relative flex-1 space-y-3 overflow-y-auto px-3 py-4 sm:space-y-4 sm:px-4 sm:py-5 md:px-6"
      >
        {group.messages.length === 0 ? (
          <p className="text-center font-serif text-sm italic text-smoke">
            Cercle vide. Tapez le premier message — il sera chiffré côté client.
          </p>
        ) : (
          group.messages.map((message) => (
            <GroupBubble
              key={message.id}
              own={message.authorHash === identity.publicHash}
              message={message}
              decrypted={decrypted[message.id]}
            />
          ))
        )}
      </div>

      <form onSubmit={send} className="border-t-[2px] border-ink p-2 sm:p-3 md:p-4">
        {error ? (
          <p className="mb-2 font-mono text-[11px] uppercase tracking-ultra text-stamp">{error}</p>
        ) : null}
        <div className="flex items-end gap-2 sm:gap-3">
          <textarea
            className="field-block min-h-[52px] flex-1 p-2.5 text-base sm:min-h-[60px] sm:p-3 md:p-4 md:text-lg"
            placeholder="Message — chiffré localement avant envoi"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                send(event as unknown as FormEvent);
              }
            }}
          />
          <button
            className="btn-stamp h-[52px] shrink-0 px-3 sm:h-[60px] sm:px-4"
            type="submit"
            disabled={!draft.trim() || sending}
          >
            {sending ? "…" : "Sceller"}
          </button>
        </div>
      </form>

      {inviteOpen && groupKey ? (
        <InviteModal
          identity={identity}
          group={group}
          groupKey={groupKey}
          conversations={conversations}
          onClose={() => setInviteOpen(false)}
          onSendDmInvite={onSendDmInvite}
        />
      ) : null}
    </article>
  );
}

function InviteModal({
  identity,
  group,
  groupKey,
  conversations,
  onClose,
  onSendDmInvite,
}: {
  identity: Identity;
  group: Group;
  groupKey: string;
  conversations: Conversation[];
  onClose: () => void;
  onSendDmInvite: (peerHash: string, ciphertext: { iv: string; cipher: string }) => Promise<void>;
}) {
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<User[]>([]);
  const [searching, setSearching] = useState(false);
  const [sendingTo, setSendingTo] = useState<string | null>(null);
  const [done, setDone] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  /* Suggestions par défaut : les pairs avec qui on a déjà ouvert une conversation. */
  const knownPeers = useMemo(() => {
    const map = new Map<
      string,
      { hash: string; username: string; pubkeyX25519: string }
    >();
    conversations.forEach((c) => {
      const isOwner = c.ownerHash === identity.publicHash;
      const peerHash = isOwner ? c.peerHash : c.ownerHash;
      const peerUsername = isOwner ? c.peerUsername : c.ownerUsername;
      const peerPub = isOwner ? c.peerPublicKeyX25519 : c.ownerPublicKeyX25519;
      if (!map.has(peerHash)) {
        map.set(peerHash, { hash: peerHash, username: peerUsername, pubkeyX25519: peerPub });
      }
    });
    return Array.from(map.values());
  }, [conversations, identity.publicHash]);

  useEffect(() => {
    if (!search.trim()) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timeout = setTimeout(async () => {
      try {
        const found = await api.searchUsers(search.trim(), identity.publicHash);
        if (!cancelled) setResults(found);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Erreur");
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 220);
    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [search, identity.publicHash]);

  async function inviteUser(peerHash: string, peerPubX25519: string) {
    setSendingTo(peerHash);
    setError(null);
    try {
      const json = encodeGroupInvite({
        groupId: group.id,
        groupName: group.name,
        key: groupKey,
      });
      const encrypted = await encryptForPeer(peerPubX25519, json);
      await onSendDmInvite(peerHash, encrypted);
      setDone((prev) => new Set(prev).add(peerHash));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setSendingTo(null);
    }
  }

  return (
    <div
      className="fixed inset-0 z-40 grid place-items-end bg-ink/40 backdrop-blur-sm sm:place-items-center sm:p-4"
      role="dialog"
    >
      <div className="leaf animate-rise-in relative max-h-[92vh] w-full overflow-y-auto p-4 sm:max-w-xl sm:p-6">
        <button
          className="absolute right-4 top-3 font-mono text-[11px] font-bold uppercase tracking-ultra text-ash hover:text-stamp"
          onClick={onClose}
        >
          × Fermer
        </button>
        <p className="kicker">Invitation</p>
        <h3 className="masthead text-2xl sm:text-3xl">Inviter dans {group.name}</h3>
        <p className="marginalia mt-1">
          Une invitation chiffrée bout-en-bout est envoyée par DM. Le destinataire clique sur
          « Rejoindre le cercle » dans le DM, et la clé est copiée chez lui automatiquement.
        </p>

        <div className="mt-5">
          <label className="kicker mb-1 block">Chercher un agent</label>
          <div className="flex items-center gap-2 border-2 border-ink bg-cream px-3 py-2">
            <span className="font-mono text-[12px] font-extrabold uppercase tracking-ultra text-ash">⌕</span>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="alias public"
              className="w-full bg-transparent font-mono text-[13px] outline-none"
              spellCheck={false}
              autoComplete="off"
            />
            {searching ? (
              <span className="inline-block h-2 w-2 animate-blink bg-stamp" aria-label="loading" />
            ) : null}
          </div>
        </div>

        {error ? (
          <p className="mt-3 border border-stamp bg-stamp/5 p-2 font-mono text-[11px] uppercase tracking-ultra text-stamp">
            {error}
          </p>
        ) : null}

        <div className="mt-5 space-y-3">
          {!search.trim() && knownPeers.length > 0 ? (
            <>
              <p className="kicker">Vos correspondants récents</p>
              <ul className="space-y-2">
                {knownPeers.map((peer) => (
                  <InviteRow
                    key={peer.hash}
                    username={peer.username}
                    publicHash={peer.hash}
                    pubkeyX25519={peer.pubkeyX25519}
                    sending={sendingTo === peer.hash}
                    invited={done.has(peer.hash)}
                    onInvite={inviteUser}
                  />
                ))}
              </ul>
            </>
          ) : null}

          {search.trim() && results.length === 0 && !searching ? (
            <p className="font-serif text-sm italic text-smoke">Aucun agent trouvé.</p>
          ) : null}

          {search.trim() && results.length > 0 ? (
            <ul className="space-y-2">
              {results.map((user) => (
                <InviteRow
                  key={user.publicHash}
                  username={user.username}
                  publicHash={user.publicHash}
                  pubkeyX25519={user.publicKeyX25519}
                  sending={sendingTo === user.publicHash}
                  invited={done.has(user.publicHash)}
                  onInvite={inviteUser}
                />
              ))}
            </ul>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function InviteRow({
  username,
  publicHash,
  pubkeyX25519,
  sending,
  invited,
  onInvite,
}: {
  username: string;
  publicHash: string;
  pubkeyX25519: string;
  sending: boolean;
  invited: boolean;
  onInvite: (peerHash: string, peerPubX25519: string) => void;
}) {
  return (
    <li className="flex items-center gap-3 border border-rule bg-cream px-3 py-2">
      <Sigil text={username} size={36} tone="cipher" />
      <div className="min-w-0 flex-1">
        <p className="truncate font-display text-base font-semibold leading-tight">@{username}</p>
        <p className="truncate font-mono text-[10.5px] text-ash">{shortHash(publicHash, 8)}</p>
      </div>
      {invited ? (
        <span className="dispatch-no shrink-0 text-cipher">envoyé ✓</span>
      ) : (
        <button
          type="button"
          disabled={sending}
          className="btn-ghost shrink-0 px-3 py-1.5 text-[10px]"
          onClick={() => onInvite(publicHash, pubkeyX25519)}
        >
          {sending ? "…" : "Inviter"}
        </button>
      )}
    </li>
  );
}

function DiscoverModal({
  groups,
  joinedGroupIds,
  onClose,
}: {
  groups: Group[];
  joinedGroupIds: Set<string>;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return groups.filter((g) => {
      if (joinedGroupIds.has(g.id)) return false;
      if (!q) return true;
      return g.name.toLowerCase().includes(q) || g.topic.toLowerCase().includes(q);
    });
  }, [groups, joinedGroupIds, search]);

  return (
    <div
      className="fixed inset-0 z-40 grid place-items-end bg-ink/40 backdrop-blur-sm sm:place-items-center sm:p-4"
      role="dialog"
    >
      <div className="leaf animate-rise-in relative flex max-h-[92vh] w-full flex-col overflow-hidden p-4 sm:max-w-2xl sm:p-6">
        <button
          className="absolute right-4 top-3 font-mono text-[11px] font-bold uppercase tracking-ultra text-ash hover:text-stamp"
          onClick={onClose}
        >
          × Fermer
        </button>
        <p className="kicker">Annuaire des cercles</p>
        <h3 className="masthead text-2xl sm:text-3xl">Découvrir</h3>
        <p className="marginalia mt-1">
          Métadonnées publiques. Pour rejoindre un cercle, demande la clé symétrique au fondateur ou attends une invitation par DM.
        </p>

        <div className="mt-5">
          <div className="flex items-center gap-2 border-2 border-ink bg-cream px-3 py-2">
            <span className="font-mono text-[12px] font-extrabold uppercase tracking-ultra text-ash">⌕</span>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="nom ou sujet"
              className="w-full bg-transparent font-mono text-[13px] outline-none"
              spellCheck={false}
              autoComplete="off"
              autoFocus
            />
          </div>
        </div>

        <div className="mt-4 flex-1 overflow-y-auto">
          {filtered.length === 0 ? (
            <p className="font-serif text-sm italic text-smoke">
              {search.trim()
                ? "Aucun cercle ne correspond."
                : "Aucun cercle public à découvrir."}
            </p>
          ) : (
            <ul className="space-y-3">
              {filtered.map((g) => (
                <li key={g.id} className="border border-rule bg-cream p-3">
                  <div className="flex items-start gap-3">
                    <Sigil text={g.name} size={36} tone="moss" />
                    <div className="min-w-0 flex-1">
                      <p className="kicker truncate">№{g.id.slice(0, 6)}</p>
                      <p className="break-words font-display text-lg font-semibold leading-tight">
                        {g.name}
                      </p>
                      <p className="mt-1 break-words font-serif text-sm leading-5 text-graphite">
                        {g.topic}
                      </p>
                      <p className="mt-2 font-mono text-[10px] uppercase tracking-ultra text-ash">
                        fondé par @{g.ownerUsername} ·{" "}
                        {(g.messages?.length || 0)} message{(g.messages?.length || 0) === 1 ? "" : "s"}
                      </p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function GroupBubble({
  own,
  message,
  decrypted,
}: {
  own: boolean;
  message: GroupMessage;
  decrypted: string | null | undefined;
}) {
  const time = new Date(message.createdAt).toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return (
    <div className={`flex ${own ? "justify-end" : "justify-start"}`}>
      <div
        className={`relative max-w-[85%] border-[1.5px] p-2.5 sm:max-w-[75%] sm:p-3 ${
          own ? "border-ink bg-cream" : "border-moss bg-moss/5 text-ink"
        }`}
        style={{ boxShadow: own ? "3px 3px 0 #181410" : "3px 3px 0 #4f6048" }}
      >
        <div className="mb-1 flex items-center justify-between gap-3 border-b border-rule pb-1">
          <span className="truncate font-mono text-[10px] font-bold uppercase tracking-ultra text-ash">
            @{message.authorUsername}
          </span>
          <span className="shrink-0 font-mono text-[10px] text-smoke">{time}</span>
        </div>
        {decrypted === undefined ? (
          <p className="font-serif text-sm italic text-smoke">Déchiffrement…</p>
        ) : decrypted === null ? (
          <p className="font-serif text-sm italic text-stamp">
            Échec — clé du cercle indisponible.
          </p>
        ) : (
          <p className="whitespace-pre-wrap break-words font-serif text-[15px] leading-6 sm:text-base sm:leading-7">
            {decrypted}
          </p>
        )}
      </div>
    </div>
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
      await saveGroupKey(group.id, key);
      setCreated({ group, key });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-40 grid place-items-end bg-ink/40 backdrop-blur-sm sm:place-items-center sm:p-4"
      role="dialog"
    >
      <div className="leaf animate-rise-in relative max-h-[92vh] w-full overflow-y-auto p-4 sm:max-w-xl sm:p-6">
        <button
          className="absolute right-4 top-3 font-mono text-[11px] font-bold uppercase tracking-ultra text-ash hover:text-stamp"
          onClick={onClose}
        >
          × Fermer
        </button>
        {!created ? (
          <form onSubmit={submit}>
            <p className="kicker">Fondation</p>
            <h3 className="masthead text-2xl sm:text-3xl md:text-4xl">Nouveau cercle</h3>
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
            <h3 className="masthead mt-3 break-words text-2xl sm:mt-4 sm:text-3xl md:text-4xl">
              {created.group.name}
            </h3>
            <p className="marginalia mt-2">
              Sa clé symétrique est conservée localement. Pour faire entrer un membre,
              transmettez-lui ces deux infos hors-bande (Signal, papier, QR code) :
            </p>
            <div className="mt-4 space-y-3">
              <CopyBox label="ID du cercle" value={created.group.id} />
              <CopyBox label="Clé symétrique (base64)" value={created.key} multiline reveal />
            </div>
            <button className="btn-stamp mt-5" onClick={() => onCreate(created.group)}>
              Entrer dans le cercle
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function JoinModal({
  groups,
  onClose,
  onJoined,
}: {
  groups: Group[];
  onClose: () => void;
  onJoined: (groupId: string) => void;
}) {
  const [groupId, setGroupId] = useState("");
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const trimmedId = groupId.trim();
      const trimmedKey = key.trim();
      if (!trimmedId || !trimmedKey) {
        setError("ID du cercle et clé symétrique requis.");
        return;
      }
      const known = groups.find((g) => g.id === trimmedId);
      if (!known) {
        setError("Cercle inconnu sur ce serveur. Demande au fondateur l'ID exact.");
        return;
      }
      // Test : on tente de déchiffrer l'intro avec la clé fournie. Si échec,
      // c'est que la clé est mauvaise.
      try {
        await decryptWithKey(trimmedKey, known.encryptedIntro);
      } catch {
        setError("Clé invalide pour ce cercle (impossible de déchiffrer l'intro).");
        return;
      }
      await saveGroupKey(trimmedId, trimmedKey);
      onJoined(trimmedId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-40 grid place-items-end bg-ink/40 backdrop-blur-sm sm:place-items-center sm:p-4"
      role="dialog"
    >
      <div className="leaf animate-rise-in relative max-h-[92vh] w-full overflow-y-auto p-4 sm:max-w-xl sm:p-6">
        <button
          className="absolute right-4 top-3 font-mono text-[11px] font-bold uppercase tracking-ultra text-ash hover:text-stamp"
          onClick={onClose}
        >
          × Fermer
        </button>
        <form onSubmit={submit}>
          <p className="kicker">Adhésion</p>
          <h3 className="masthead text-2xl sm:text-3xl md:text-4xl">Rejoindre un cercle</h3>
          <p className="marginalia mt-1">
            Le fondateur t'a transmis l'ID et la clé symétrique hors-bande. Colle-les ici
            pour stocker la clé localement et déchiffrer les messages.
          </p>
          <div className="mt-5 space-y-4">
            <div>
              <label className="kicker mb-1 block">ID du cercle (UUID)</label>
              <input
                className="field-mono"
                placeholder="00000000-0000-0000-0000-000000000000"
                value={groupId}
                onChange={(event) => setGroupId(event.target.value)}
                spellCheck={false}
                autoFocus
              />
            </div>
            <div>
              <label className="kicker mb-1 block">Clé symétrique (base64)</label>
              <textarea
                className="field-block min-h-[80px] font-mono text-[12px]"
                placeholder="MFkwEwYHKoZIzj0CAQYI... (44 chars)"
                value={key}
                onChange={(event) => setKey(event.target.value)}
                spellCheck={false}
              />
            </div>
          </div>
          {error ? (
            <p className="mt-3 font-mono text-[11px] uppercase tracking-ultra text-stamp">{error}</p>
          ) : null}
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <button className="btn-stamp" disabled={submitting}>
              {submitting ? "Vérification…" : "Rejoindre"}
            </button>
            <button type="button" className="btn-ghost" onClick={onClose}>
              Annuler
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
