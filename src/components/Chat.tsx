import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import * as api from "../lib/api";
import {
  type DecodedMessage,
  decodeMessageContent,
  decryptFromPeer,
  encryptForPeer,
  shortHash,
} from "../lib/crypto";
import type { Conversation, Identity, Message, User } from "../types";
import { SearchModal } from "./SearchModal";
import { Empty, Sigil, Stamp } from "./ui";

export function ChatView({
  identity,
  conversations,
  activeId,
  setActiveId,
  joinedGroupIds,
  onMessage,
  onOpenConversationWith,
  onAcceptInvite,
}: {
  identity: Identity;
  conversations: Conversation[];
  activeId: string | null;
  setActiveId: (id: string | null) => void;
  joinedGroupIds: Set<string>;
  onMessage: (conversationId: string, message: Message) => void;
  onOpenConversationWith: (user: User) => void | Promise<void>;
  onAcceptInvite: (groupId: string, key: string) => Promise<void>;
}) {
  const active = useMemo(
    () => conversations.find((c) => c.id === activeId) || null,
    [conversations, activeId],
  );
  const [searchOpen, setSearchOpen] = useState(false);

  const showThreadOnMobile = active !== null;

  return (
    <section className="grid gap-4 md:grid-cols-[260px_minmax(0,1fr)] md:gap-6">
      <ConversationList
        identity={identity}
        conversations={conversations}
        activeId={activeId}
        setActiveId={setActiveId}
        onNewConversation={() => setSearchOpen(true)}
        hiddenOnMobile={showThreadOnMobile}
      />
      <div className={`min-h-[calc(100vh-220px)] ${showThreadOnMobile ? "" : "hidden md:block"}`}>
        {active ? (
          <Thread
            identity={identity}
            conversation={active}
            joinedGroupIds={joinedGroupIds}
            onMessage={onMessage}
            onBack={() => setActiveId(null)}
            onAcceptInvite={onAcceptInvite}
          />
        ) : (
          <Empty
            title="Aucune correspondance ouverte"
            hint="Cherchez un agent dans le directoire pour ouvrir un pli chiffré."
          />
        )}
      </div>

      {searchOpen ? (
        <SearchModal
          identity={identity}
          onClose={() => setSearchOpen(false)}
          onOpen={async (user) => {
            await onOpenConversationWith(user);
          }}
        />
      ) : null}
    </section>
  );
}

function ConversationList({
  identity,
  conversations,
  activeId,
  setActiveId,
  onNewConversation,
  hiddenOnMobile,
}: {
  identity: Identity;
  conversations: Conversation[];
  activeId: string | null;
  setActiveId: (id: string) => void;
  onNewConversation: () => void;
  hiddenOnMobile: boolean;
}) {
  return (
    <aside
      className={`${
        hiddenOnMobile ? "hidden md:block" : "block"
      } md:max-h-[calc(100vh-100px)] md:overflow-auto md:border-r md:border-rule md:pr-4`}
    >
      <header className="flex items-end justify-between gap-3 border-b-[3px] border-double border-ink pb-2">
        <div className="min-w-0">
          <p className="kicker">Plis</p>
          <h3 className="masthead text-2xl sm:text-3xl">Bureau</h3>
          <p className="marginalia">Tous les fils chiffrés.</p>
        </div>
        <button
          type="button"
          className="btn-stamp shrink-0 px-3 py-2 text-[10px]"
          onClick={onNewConversation}
        >
          + Nouvelle
        </button>
      </header>

      <ul className="mt-3 space-y-2">
        {conversations.length === 0 ? (
          <li className="border border-dashed border-rule p-3 font-serif text-sm italic text-smoke">
            Pas encore de pli. Cherchez un agent depuis le directoire ci-dessus.
          </li>
        ) : (
          conversations.map((c) => {
            const isActive = c.id === activeId;
            const last = c.messages[c.messages.length - 1];
            const isOwner = c.ownerHash === identity.publicHash;
            const otherUsername = isOwner ? c.peerUsername : c.ownerUsername;
            return (
              <li key={c.id}>
                <button
                  onClick={() => setActiveId(c.id)}
                  className={`flex w-full items-center gap-3 border-l-[3px] py-2 pl-2 pr-2 text-left transition ${
                    isActive
                      ? "border-stamp bg-stamp/5"
                      : "border-transparent hover:bg-cream"
                  }`}
                >
                  <Sigil
                    text={otherUsername}
                    size={36}
                    tone={isActive ? "stamp" : "ink"}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-display text-base font-semibold leading-tight">
                      @{otherUsername}
                    </p>
                    <p className="truncate font-mono text-[10.5px] text-ash">
                      {last
                        ? `${last.authorHash === identity.publicHash ? "→" : "←"} ${shortHash(last.encrypted.cipher, 5)}`
                        : "fil ouvert"}
                    </p>
                  </div>
                  <span className="dispatch-no shrink-0">{c.messages.length}</span>
                </button>
              </li>
            );
          })
        )}
      </ul>
    </aside>
  );
}

function Thread({
  identity,
  conversation,
  joinedGroupIds,
  onMessage,
  onBack,
  onAcceptInvite,
}: {
  identity: Identity;
  conversation: Conversation;
  joinedGroupIds: Set<string>;
  onMessage: (conversationId: string, message: Message) => void;
  onBack: () => void;
  onAcceptInvite: (groupId: string, key: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [decoded, setDecoded] = useState<Record<string, DecodedMessage | null>>({});
  const scrollRef = useRef<HTMLDivElement>(null);

  /* Selon que l'utilisateur courant est ownerHash ou peerHash de la conversation,
     la pubkey X25519 du *vrai* peer (l'autre) n'est pas la même colonne en BDD.
     ECDH(myPriv, otherPub) doit donner la même clé partagée des deux côtés. */
  const isOwner = conversation.ownerHash === identity.publicHash;
  const otherPubKeyX25519 = isOwner
    ? conversation.peerPublicKeyX25519
    : conversation.ownerPublicKeyX25519;
  const otherUsername = isOwner ? conversation.peerUsername : conversation.ownerUsername;
  const otherHash = isOwner ? conversation.peerHash : conversation.ownerHash;

  useEffect(() => {
    let cancelled = false;
    async function decryptAll() {
      const out: Record<string, DecodedMessage | null> = {};
      for (const message of conversation.messages) {
        try {
          const plain = await decryptFromPeer(otherPubKeyX25519, message.encrypted);
          out[message.id] = decodeMessageContent(plain);
        } catch {
          out[message.id] = null;
        }
      }
      if (!cancelled) setDecoded(out);
    }
    decryptAll();
    return () => {
      cancelled = true;
    };
  }, [conversation, identity, otherPubKeyX25519]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [conversation.messages.length]);

  async function send(event: FormEvent) {
    event.preventDefault();
    if (!draft.trim() || sending) return;
    setSending(true);
    setError(null);
    try {
      const encrypted = await encryptForPeer(otherPubKeyX25519, draft.trim());
      const message = await api.createMessage(conversation.id, {
        authorHash: identity.publicHash,
        authorUsername: identity.username,
        encrypted,
      });
      onMessage(conversation.id, message);
      setDraft("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setSending(false);
    }
  }

  return (
    <article className="leaf flex h-[calc(100vh-180px)] flex-col md:h-[calc(100vh-160px)]">
      <header className="flex items-center justify-between gap-3 border-b-[2px] border-ink p-3 sm:gap-4 sm:p-4 md:p-5">
        <button
          type="button"
          className="btn-icon md:hidden"
          aria-label="Retour à la liste"
          onClick={onBack}
        >
          ←
        </button>
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          <Sigil text={otherUsername} size={40} tone="cipher" />
          <div className="min-w-0">
            <p className="kicker">Privé</p>
            <h2 className="truncate font-display text-xl font-bold leading-none sm:text-2xl md:text-3xl">
              <span className="text-stamp">@</span>
              {otherUsername}
            </h2>
            <p className="mt-1 truncate font-mono text-[10.5px] text-ash">
              clé peer {shortHash(otherHash, 6)}
            </p>
          </div>
        </div>
        <span className="hidden shrink-0 sm:inline-flex">
          <Stamp tone="cipher" rotate={-5}>X25519 · AES-GCM</Stamp>
        </span>
      </header>

      <div
        ref={scrollRef}
        className="relative flex-1 space-y-3 overflow-y-auto px-3 py-4 sm:space-y-4 sm:px-4 sm:py-5 md:px-6"
      >
        <Watermark />
        {conversation.messages.length === 0 ? (
          <p className="text-center font-serif text-sm italic text-smoke">
            Pli vide. Tapez votre premier message — il sera chiffré côté client.
          </p>
        ) : (
          conversation.messages.map((message) => (
            <Bubble
              key={message.id}
              own={message.authorHash === identity.publicHash}
              message={message}
              decoded={decoded[message.id]}
              alreadyJoined={
                decoded[message.id]?.type === "group_invite" &&
                joinedGroupIds.has(
                  (decoded[message.id] as { groupId: string }).groupId,
                )
              }
              onAcceptInvite={onAcceptInvite}
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
        <p className="marginalia mt-2 hidden sm:block">
          La clé est dérivée à chaque chiffrement à partir de votre clé privée et de la clé publique du destinataire.
        </p>
      </form>
    </article>
  );
}

function Bubble({
  own,
  message,
  decoded,
  alreadyJoined,
  onAcceptInvite,
}: {
  own: boolean;
  message: Message;
  decoded: DecodedMessage | null | undefined;
  alreadyJoined: boolean;
  onAcceptInvite: (groupId: string, key: string) => Promise<void>;
}) {
  const time = new Date(message.createdAt).toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
  });

  const isInvite = decoded?.type === "group_invite";

  return (
    <div className={`flex ${own ? "justify-end" : "justify-start"}`}>
      <div
        className={`relative max-w-[85%] border-[1.5px] p-2.5 sm:max-w-[75%] sm:p-3 ${
          isInvite
            ? "border-moss bg-moss/10 text-ink"
            : own
              ? "border-ink bg-cream"
              : "border-cipher bg-cipher/5 text-ink"
        }`}
        style={{
          boxShadow: isInvite
            ? "3px 3px 0 #4f6048"
            : own
              ? "3px 3px 0 #181410"
              : "3px 3px 0 #1f3552",
        }}
      >
        <div className="mb-1 flex items-center justify-between gap-3 border-b border-rule pb-1">
          <span className="truncate font-mono text-[10px] font-bold uppercase tracking-ultra text-ash">
            @{message.authorUsername}
          </span>
          <span className="shrink-0 font-mono text-[10px] text-smoke">{time}</span>
        </div>
        {decoded === undefined ? (
          <p className="font-serif text-sm italic text-smoke">Déchiffrement…</p>
        ) : decoded === null ? (
          <p className="font-serif text-sm italic text-stamp">
            Échec du déchiffrement — clé indisponible.
          </p>
        ) : decoded.type === "group_invite" ? (
          <InviteCard
            invite={decoded}
            alreadyJoined={alreadyJoined}
            ownInvite={own}
            onAccept={() => onAcceptInvite(decoded.groupId, decoded.key)}
          />
        ) : (
          <p className="whitespace-pre-wrap break-words font-serif text-[15px] leading-6 sm:text-base sm:leading-7">
            {decoded.body}
          </p>
        )}
        <p className="mt-2 truncate font-mono text-[9.5px] text-chalk">
          cipher {shortHash(message.encrypted.cipher, 6)}
        </p>
      </div>
    </div>
  );
}

function InviteCard({
  invite,
  alreadyJoined,
  ownInvite,
  onAccept,
}: {
  invite: { groupId: string; groupName: string; key: string };
  alreadyJoined: boolean;
  ownInvite: boolean;
  onAccept: () => void;
}) {
  const [accepting, setAccepting] = useState(false);
  return (
    <div className="space-y-2">
      <p className="font-mono text-[10px] uppercase tracking-ultra text-moss">
        Invitation à un cercle
      </p>
      <p className="font-display text-lg font-bold leading-tight">{invite.groupName}</p>
      <p className="break-all font-mono text-[10.5px] text-ash">№{invite.groupId.slice(0, 8)}</p>
      {ownInvite ? (
        <p className="marginalia">Invitation envoyée. La clé est embarquée dans le message chiffré.</p>
      ) : alreadyJoined ? (
        <p className="font-serif text-sm italic text-cipher">Vous avez rejoint ce cercle.</p>
      ) : (
        <button
          type="button"
          className="btn-stamp w-full px-3 py-2 text-[10px]"
          disabled={accepting}
          onClick={async () => {
            setAccepting(true);
            try {
              await onAccept();
            } finally {
              setAccepting(false);
            }
          }}
        >
          {accepting ? "Adhésion…" : "Rejoindre le cercle"}
        </button>
      )}
    </div>
  );
}

function Watermark() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 grid place-items-center opacity-[0.06]"
    >
      <span className="font-display text-[20vw] font-black uppercase italic tracking-tight text-stamp md:text-[12vw]">
        privé
      </span>
    </div>
  );
}
