import { useEffect, useState } from "react";
import { ChatView } from "./components/Chat";
import { Dossier } from "./components/Dossier";
import { Feed } from "./components/Feed";
import { Groups } from "./components/Groups";
import { Shell, View } from "./components/Layout";
import { Onboarding } from "./components/Onboarding";
import { SearchPanel } from "./components/Search";
import * as api from "./lib/api";
import {
  activateIdentity,
  clearSession,
  deactivateIdentity,
  detectCurve25519Support,
  ensureCrypto,
  forgetIdentity,
  hasStoredIdentity,
  tryAutoUnlock,
  unlockIdentity,
} from "./lib/crypto";
import { isRealtimeEnabled, subscribeBootstrap } from "./lib/realtime";
import type {
  Conversation,
  Group,
  Health,
  Identity,
  Message,
  Post,
  User,
} from "./types";

type Stage = "boot" | "unlock" | "onboard" | "ready";

function readView(): View {
  const value = window.location.hash.replace("#", "");
  if (value === "feed" || value === "chat" || value === "groups" || value === "dossier") {
    return value;
  }
  return "feed";
}

export default function App() {
  const [stage, setStage] = useState<Stage>("boot");
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [view, setView] = useState<View>(readView);
  const [posts, setPosts] = useState<Post[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [unlocking, setUnlocking] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function boot() {
      if (!ensureCrypto()) {
        setBootError("WebCrypto indisponible — utilisez HTTPS ou un navigateur récent.");
        return;
      }
      const support = await detectCurve25519Support();
      if (!support.ed25519 || !support.x25519) {
        setBootError(
          "Votre navigateur ne supporte pas Ed25519 ou X25519. " +
            "Mise à jour requise : Chrome 133+, Firefox 130+, Safari 17+, Edge 133+.",
        );
        return;
      }
      const stored = await hasStoredIdentity();
      if (cancelled) return;
      if (!stored) {
        setStage("onboard");
        return;
      }
      // Tentative de déverrouillage automatique via session courte (1h sliding).
      const cached = await tryAutoUnlock();
      if (cancelled) return;
      if (cached) {
        await activateIdentity(cached);
        await enter(cached);
        return;
      }
      setStage("unlock");
    }
    boot();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onHash = () => setView(readView());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  async function tryUnlock(password: string) {
    setUnlocking(true);
    setUnlockError(null);
    try {
      const next = await unlockIdentity(password);
      if (!next) {
        setUnlockError("Mot de passe local incorrect.");
        return;
      }
      await activateIdentity(next, password);
      await enter(next);
    } catch (err) {
      setUnlockError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setUnlocking(false);
    }
  }

  async function enter(next: Identity) {
    setIdentity(next);
    try {
      const [bootstrap, healthInfo] = await Promise.all([
        api.getBootstrap(next.publicHash),
        api.getHealth().catch(() => null),
      ]);
      setPosts(bootstrap.posts);
      setConversations(bootstrap.conversations);
      setGroups(bootstrap.groups);
      setActiveChatId(bootstrap.conversations[0]?.id || null);
      setHealth(healthInfo);
      setStage("ready");
    } catch (err) {
      setBootError(err instanceof Error ? err.message : "Erreur d'amorçage");
      setStage("ready");
    }
  }

  /* Realtime : push WebSocket des INSERT messages, posts, conversations.
     Filtrage côté consommateur : on n'ajoute un message que si la conv est
     déjà dans notre state (donc « concerne » l'utilisateur). */
  useEffect(() => {
    if (!identity || stage !== "ready") return;
    if (!isRealtimeEnabled()) return;
    const knownConversationIds = new Set(conversations.map((c) => c.id));
    const unsubscribe = subscribeBootstrap({
      ownerHash: identity.publicHash,
      onPost: (post) => {
        setPosts((items) => (items.find((p) => p.id === post.id) ? items : [post, ...items]));
      },
      onMessage: (conversationId, message) => {
        if (!knownConversationIds.has(conversationId)) return;
        setConversations((items) =>
          items.map((c) =>
            c.id === conversationId
              ? c.messages.find((m) => m.id === message.id)
                ? c
                : { ...c, messages: [...c.messages, message] }
              : c,
          ),
        );
      },
      onConversation: (conv) => {
        knownConversationIds.add(conv.id);
        setConversations((items) =>
          items.find((c) => c.id === conv.id) ? items : [conv, ...items],
        );
      },
    });
    return () => unsubscribe();
    // On ré-abonne quand la liste de conversations change pour rafraîchir le filtre INSERT messages.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity, stage, conversations.length]);

  function navigate(next: View) {
    window.location.hash = next;
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function openConversationWith(user: User) {
    if (!identity) return;
    const conversation = await api.createConversation({
      ownerHash: identity.publicHash,
      peerHash: user.publicHash,
      peerUsername: user.username,
      peerPublicKeyX25519: user.publicKeyX25519,
    });
    setConversations((items) => {
      const existing = items.find((c) => c.id === conversation.id);
      if (existing) return items;
      return [conversation, ...items];
    });
    setActiveChatId(conversation.id);
    navigate("chat");
  }

  async function logout() {
    await forgetIdentity();
    clearSession();
    deactivateIdentity();
    setIdentity(null);
    setPosts([]);
    setConversations([]);
    setGroups([]);
    setActiveChatId(null);
    setStage("onboard");
    window.location.hash = "feed";
  }

  if (bootError) {
    return (
      <div className="grid min-h-screen place-items-center px-6 text-center">
        <div className="leaf max-w-lg p-8">
          <p className="kicker-stamp">Anomalie</p>
          <h1 className="masthead mt-3 text-4xl">Le bureau est fermé</h1>
          <p className="marginalia mt-3">{bootError}</p>
        </div>
      </div>
    );
  }

  if (stage === "boot") {
    return (
      <div className="grid min-h-screen place-items-center">
        <span className="font-mono text-[11px] uppercase tracking-ultra text-ash">
          Mise sous presse…
        </span>
      </div>
    );
  }

  if (stage === "unlock") {
    return (
      <UnlockScreen
        onUnlock={tryUnlock}
        onForget={logout}
        error={unlockError}
        loading={unlocking}
      />
    );
  }

  if (stage === "onboard" || !identity) {
    return (
      <Onboarding
        onReady={async (fresh) => {
          setIdentity(fresh);
          await enter(fresh);
        }}
      />
    );
  }

  return (
    <Shell
      view={view}
      navigate={navigate}
      identity={identity}
      conversations={conversations}
      health={health}
      rightRail={<SearchPanel identity={identity} onOpen={openConversationWith} />}
    >
      {view === "feed" ? (
        <Feed
          identity={identity}
          posts={posts}
          onPost={(post: Post) => setPosts((items) => [post, ...items])}
        />
      ) : null}
      {view === "chat" ? (
        <ChatView
          identity={identity}
          conversations={conversations}
          activeId={activeChatId}
          setActiveId={setActiveChatId}
          onMessage={(conversationId: string, message: Message) =>
            setConversations((items) =>
              items.map((c) =>
                c.id === conversationId ? { ...c, messages: [...c.messages, message] } : c,
              ),
            )
          }
          onOpenConversationWith={openConversationWith}
        />
      ) : null}
      {view === "groups" ? (
        <Groups
          identity={identity}
          groups={groups}
          onCreate={(group: Group) => setGroups((items) => [group, ...items])}
        />
      ) : null}
      {view === "dossier" ? <Dossier identity={identity} onLogout={logout} /> : null}
    </Shell>
  );
}

function UnlockScreen({
  onUnlock,
  onForget,
  error,
  loading,
}: {
  onUnlock: (password: string) => void;
  onForget: () => void;
  error: string | null;
  loading: boolean;
}) {
  const [password, setPassword] = useState("");
  return (
    <div className="grid min-h-screen place-items-center px-6">
      <form
        className="leaf w-full max-w-md p-8"
        onSubmit={(e) => {
          e.preventDefault();
          if (password) onUnlock(password);
        }}
      >
        <p className="kicker">Bureau scellé</p>
        <h1 className="masthead mt-2 text-4xl">Déverrouiller</h1>
        <p className="marginalia mt-3">
          Mot de passe local — utilisé uniquement pour déchiffrer votre clé privée
          stockée dans ce navigateur. Il n'est jamais transmis au serveur.
        </p>
        <label className="kicker mt-6 block">Mot de passe local</label>
        <input
          type="password"
          autoFocus
          autoComplete="current-password"
          className="field"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error ? (
          <p className="mt-3 inline-flex border-2 border-stamp bg-stamp/5 px-2 py-1 font-mono text-[11px] font-bold uppercase tracking-ultra text-stamp">
            {error}
          </p>
        ) : null}
        <div className="mt-6 flex flex-wrap gap-3">
          <button className="btn-stamp" type="submit" disabled={!password || loading}>
            {loading ? "Déchiffrement…" : "Entrer"}
          </button>
          <button type="button" className="btn-ghost" onClick={onForget}>
            Effacer ce dossier
          </button>
        </div>
      </form>
    </div>
  );
}
