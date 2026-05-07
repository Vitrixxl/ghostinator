import { useEffect, useState } from "react";
import { ChatView } from "./components/Chat";
import { Dossier } from "./components/Dossier";
import { Feed } from "./components/Feed";
import { Groups } from "./components/Groups";
import { Shell, View } from "./components/Layout";
import { Onboarding } from "./components/Onboarding";
import { SearchPanel } from "./components/Search";
import * as api from "./lib/api";
import { ensureCrypto, loadIdentity } from "./lib/crypto";
import type {
  Conversation,
  Group,
  Health,
  Identity,
  Message,
  Post,
  User,
} from "./types";

type Stage = "boot" | "onboard" | "ready";

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

  /* boot */
  useEffect(() => {
    if (!ensureCrypto()) {
      setBootError("WebCrypto indisponible — utilisez HTTPS ou un navigateur récent.");
      return;
    }
    const stored = loadIdentity();
    if (!stored) {
      setStage("onboard");
      return;
    }
    enter(stored);
  }, []);

  /* hash routing */
  useEffect(() => {
    const onHash = () => setView(readView());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

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
      peerPublicKey: user.publicKey,
    });
    setConversations((items) => {
      const existing = items.find((c) => c.id === conversation.id);
      if (existing) return items;
      return [conversation, ...items];
    });
    setActiveChatId(conversation.id);
    navigate("chat");
  }

  function logout() {
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

  if (stage === "onboard" || !identity) {
    return <Onboarding onReady={enter} />;
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
