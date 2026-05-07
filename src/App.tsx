import {
  Hash,
  Home,
  Lock,
  MessageCircle,
  Plus,
  RefreshCw,
  Search,
  Send,
  Settings,
  Shield,
  Users,
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  createConversation,
  createGroup,
  createMessage,
  createPost,
  getBootstrap,
  getHealth,
} from "./lib/api";
import {
  decryptText,
  encryptText,
  ensureCrypto,
  generateAesKey,
  generateIdentity,
  loadChannelKey,
  loadIdentity,
  saveChannelKey,
  savePublicName,
} from "./lib/crypto";
import type { Conversation, Group, Health, Identity, Post } from "./types";

type View = "feed" | "chat" | "groups" | "security";

const navItems: { id: View; label: string; icon: typeof Home }[] = [
  { id: "feed", label: "Feed", icon: Home },
  { id: "chat", label: "Messages", icon: MessageCircle },
  { id: "groups", label: "Groupes", icon: Users },
  { id: "security", label: "Sécurité", icon: Shield },
];

function short(value: string, size = 10) {
  return value.length > size ? `${value.slice(0, size)}...` : value;
}

function relativeTime(value: string) {
  const diff = Math.max(1, Math.round((Date.now() - new Date(value).getTime()) / 60000));
  if (diff < 60) return `${diff} min`;
  const hours = Math.round(diff / 60);
  if (hours < 24) return `${hours} h`;
  return `${Math.round(hours / 24)} j`;
}

function routeFromHash(): View {
  const value = window.location.hash.replace("#", "");
  return navItems.some((item) => item.id === value) ? (value as View) : "feed";
}

function App() {
  const [view, setView] = useState<View>(routeFromHash);
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [postBody, setPostBody] = useState("");
  const [messageBody, setMessageBody] = useState("");
  const [publicNameDraft, setPublicNameDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  const activeConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === activeConversationId) || null,
    [activeConversationId, conversations],
  );

  useEffect(() => {
    const onHash = () => setView(routeFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    async function boot() {
      try {
        if (!ensureCrypto()) throw new Error("WebCrypto indisponible");
        const [localIdentity, apiHealth, bootstrap] = await Promise.all([
          loadIdentity(),
          getHealth(),
          getBootstrap(),
        ]);
        setIdentity(localIdentity);
        setPublicNameDraft(localIdentity.publicName);
        setHealth(apiHealth);
        setPosts(bootstrap.posts);
        setConversations(bootstrap.conversations);
        setGroups(bootstrap.groups);
        setActiveConversationId(bootstrap.conversations[0]?.id || null);
      } catch (bootError) {
        setError(bootError instanceof Error ? bootError.message : "Erreur de démarrage");
      }
    }
    boot();
  }, []);

  function navigate(nextView: View) {
    window.location.hash = nextView;
    window.scrollTo({ top: 0, behavior: "auto" });
  }

  function updatePublicName(event: FormEvent) {
    event.preventDefault();
    if (!identity) return;
    const clean = publicNameDraft.trim().slice(0, 40);
    if (!clean) return;
    setIdentity(savePublicName(identity, clean));
  }

  async function rotateIdentity() {
    const nextIdentity = await generateIdentity();
    setIdentity(nextIdentity);
    setPublicNameDraft(nextIdentity.publicName);
  }

  async function publishPost(event: FormEvent) {
    event.preventDefault();
    if (!identity || !postBody.trim()) return;
    const post = await createPost({
      authorHandle: identity.publicName,
      authorHash: identity.publicHash,
      body: postBody.trim(),
    });
    setPosts((items) => [post, ...items]);
    setPostBody("");
  }

  async function startConversation() {
    if (!identity) return;
    const peerHandle = window.prompt("Nom public du destinataire", "Nouveau contact");
    if (!peerHandle) return;
    const peerHash = window.prompt("Hash public du destinataire", crypto.randomUUID().replaceAll("-", ""));
    if (!peerHash) return;
    const conversation = await createConversation({
      ownerHash: identity.publicHash,
      peerHandle,
      peerHash,
    });
    const key = await generateAesKey();
    saveChannelKey("dm", conversation.id, key);
    const encrypted = await encryptText(key, "Conversation initialisée. Le serveur n'a reçu qu'un blob chiffré.");
    const firstMessage = await createMessage(conversation.id, {
      authorHash: identity.publicHash,
      authorHandle: identity.publicName,
      encrypted,
    });
    const hydrated = { ...conversation, messages: [firstMessage] };
    setConversations((items) => [hydrated, ...items]);
    setActiveConversationId(conversation.id);
    navigate("chat");
  }

  async function sendMessage(event: FormEvent) {
    event.preventDefault();
    if (!identity || !activeConversation || !messageBody.trim()) return;
    const key = loadChannelKey("dm", activeConversation.id);
    if (!key) {
      setError("Clé locale absente pour cette conversation. Les anciens messages restent visibles comme ciphertext.");
      return;
    }
    const encrypted = await encryptText(key, messageBody.trim());
    const message = await createMessage(activeConversation.id, {
      authorHash: identity.publicHash,
      authorHandle: identity.publicName,
      encrypted,
    });
    setConversations((items) =>
      items.map((conversation) =>
        conversation.id === activeConversation.id
          ? { ...conversation, messages: [...conversation.messages, message] }
          : conversation,
      ),
    );
    setMessageBody("");
  }

  async function startGroup() {
    if (!identity) return;
    const name = window.prompt("Nom du groupe", "Nouveau groupe");
    if (!name) return;
    const topic =
      window.prompt("Sujet public du groupe", "Salon public côté métadonnées, contenu chiffré côté client.") ||
      "Salon public côté métadonnées, contenu chiffré côté client.";
    const key = await generateAesKey();
    const encryptedIntro = await encryptText(key, `Bienvenue dans ${name}. Intro chiffrée côté client.`);
    const group = await createGroup({
      ownerHash: identity.publicHash,
      name,
      topic,
      encryptedIntro,
    });
    saveChannelKey("group", group.id, key);
    setGroups((items) => [group, ...items]);
    navigate("groups");
  }

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[320px_minmax(0,1fr)]">
      <SocialSidebar
        activeConversationId={activeConversationId}
        conversations={conversations}
        groups={groups}
        health={health}
        identity={identity}
        navigate={navigate}
        publicNameDraft={publicNameDraft}
        rotateIdentity={rotateIdentity}
        setActiveConversationId={setActiveConversationId}
        setPublicNameDraft={setPublicNameDraft}
        updatePublicName={updatePublicName}
        view={view}
      />

      <main className="mx-auto w-full max-w-[1180px] px-4 pb-24 pt-5 md:px-8 lg:pb-8">
        <TopBar health={health} />

        {error ? (
          <div className="mb-5 rounded-md border border-alarm/60 bg-alarm/10 px-4 py-3 font-mono text-sm text-alarm">
            {error}
          </div>
        ) : null}

        {view === "feed" ? (
          <Feed
            identity={identity}
            postBody={postBody}
            posts={posts}
            publishPost={publishPost}
            setPostBody={setPostBody}
          />
        ) : null}
        {view === "chat" ? (
          <Chat
            activeConversation={activeConversation}
            identity={identity}
            messageBody={messageBody}
            sendMessage={sendMessage}
            setMessageBody={setMessageBody}
            startConversation={startConversation}
          />
        ) : null}
        {view === "groups" ? <Groups groups={groups} startGroup={startGroup} /> : null}
        {view === "security" ? <Security health={health} /> : null}
      </main>

      <MobileNav navigate={navigate} view={view} />
    </div>
  );
}

function SocialSidebar(props: {
  activeConversationId: string | null;
  conversations: Conversation[];
  groups: Group[];
  health: Health | null;
  identity: Identity | null;
  navigate: (view: View) => void;
  publicNameDraft: string;
  rotateIdentity: () => void;
  setActiveConversationId: (id: string) => void;
  setPublicNameDraft: (value: string) => void;
  updatePublicName: (event: FormEvent) => void;
  view: View;
}) {
  return (
    <aside className="hidden min-h-screen border-r border-line bg-ink/70 p-5 backdrop-blur lg:block">
      <div className="mb-6 flex items-center gap-3">
        <div className="grid h-12 w-12 place-items-center border border-gold/50 font-serif text-3xl italic text-gold">
          g
        </div>
        <div>
          <p className="font-serif text-2xl font-bold leading-none">Ghostinator</p>
          <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.16em] text-muted">
            Social anonyme E2E
          </p>
        </div>
      </div>

      <section className="rounded-md border border-mint/40 bg-mint/10 p-4">
        <p className="font-mono text-xs uppercase tracking-[0.16em] text-mint">Profil public</p>
        <form className="mt-3 space-y-3" onSubmit={props.updatePublicName}>
          <input
            className="field h-11 py-0"
            maxLength={40}
            value={props.publicNameDraft}
            onChange={(event) => props.setPublicNameDraft(event.target.value)}
            placeholder="Nom public"
          />
          <div className="flex gap-2">
            <button className="outline-button min-h-9 flex-1 px-3 text-[11px]" type="submit">
              Sauver
            </button>
            <button
              className="outline-button min-h-9 px-3 text-[11px]"
              onClick={props.rotateIdentity}
              type="button"
              aria-label="Nouvelle identité"
            >
              <RefreshCw size={15} />
            </button>
          </div>
        </form>
        <p className="mt-3 truncate font-mono text-xs text-muted">
          {props.identity ? `hash ${props.identity.publicHash.slice(0, 16)}` : "création clé locale"}
        </p>
      </section>

      <nav className="my-6 space-y-2">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              className={`flex w-full items-center gap-3 rounded-md border px-3 py-3 text-left transition ${
                props.view === item.id
                  ? "border-signal/60 bg-signal/10 text-signal"
                  : "border-transparent text-muted hover:border-line hover:bg-white/[0.035] hover:text-bone"
              }`}
              onClick={() => props.navigate(item.id)}
            >
              <Icon size={18} />
              <span className="font-mono text-sm font-bold">{item.label}</span>
            </button>
          );
        })}
      </nav>

      <SidebarList title="Messages" icon={<MessageCircle size={15} />} empty="Aucun message">
        {props.conversations.slice(0, 5).map((conversation) => (
          <button
            key={conversation.id}
            className={`w-full rounded-md border p-3 text-left ${
              props.activeConversationId === conversation.id
                ? "border-signal/50 bg-signal/10"
                : "border-line bg-panel/30"
            }`}
            onClick={() => {
              props.setActiveConversationId(conversation.id);
              props.navigate("chat");
            }}
          >
            <strong className="block truncate text-sm">{conversation.peerHandle}</strong>
            <span className="mt-1 block truncate font-mono text-xs text-muted">
              {conversation.messages.length} blobs chiffrés
            </span>
          </button>
        ))}
      </SidebarList>

      <SidebarList title="Groupes" icon={<Users size={15} />} empty="Aucun groupe">
        {props.groups.slice(0, 5).map((group) => (
          <button
            key={group.id}
            className="w-full rounded-md border border-line bg-panel/30 p-3 text-left"
            onClick={() => props.navigate("groups")}
          >
            <strong className="block truncate text-sm">{group.name}</strong>
            <span className="mt-1 block truncate font-mono text-xs text-muted">{group.memberCount} membres</span>
          </button>
        ))}
      </SidebarList>

      <div
        className={`mt-5 rounded-md border px-3 py-2 font-mono text-xs ${
          props.health?.db === "supabase"
            ? "border-mint/50 bg-mint/10 text-mint"
            : "border-ember/60 bg-ember/10 text-ember"
        }`}
      >
        DB: {props.health?.db === "supabase" ? "Supabase" : "JSON local dev"}
      </div>
    </aside>
  );
}

function SidebarList({
  children,
  empty,
  icon,
  title,
}: {
  children: React.ReactNode;
  empty: string;
  icon: React.ReactNode;
  title: string;
}) {
  const hasChildren = Array.isArray(children) ? children.length > 0 : Boolean(children);
  return (
    <section className="mt-5">
      <div className="mb-3 flex items-center gap-2 font-mono text-xs font-bold uppercase tracking-[0.14em] text-muted">
        {icon}
        {title}
      </div>
      <div className="space-y-2">{hasChildren ? children : <p className="text-sm text-muted">{empty}</p>}</div>
    </section>
  );
}

function TopBar({ health }: { health: Health | null }) {
  return (
    <header className="mb-5 flex flex-col gap-3 rounded-md border border-line bg-panel/50 p-4 md:flex-row md:items-center md:justify-between">
      <div className="flex min-w-0 items-center gap-3">
        <div className="grid h-10 w-10 place-items-center rounded-md border border-signal/50 bg-signal/10 text-signal">
          <Search size={18} />
        </div>
        <div className="min-w-0">
          <p className="font-mono text-xs uppercase tracking-[0.16em] text-muted">Réseau social anonyme</p>
          <h1 className="truncate font-serif text-3xl font-bold">Feed public, messages privés, groupes chiffrés</h1>
        </div>
      </div>
      <div className="rounded-md border border-line bg-ink/50 px-3 py-2 font-mono text-xs text-muted">
        API: {health?.edge === "cloudflare" ? "Cloudflare Worker" : "dev local"} · DB: {health?.db || "..."}
      </div>
    </header>
  );
}

function MobileNav({ navigate, view }: { navigate: (view: View) => void; view: View }) {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 flex h-16 items-center justify-center gap-4 border-t border-line bg-ink/95 px-3 backdrop-blur lg:hidden">
      {navItems.map((item) => {
        const Icon = item.icon;
        return (
          <button
            key={item.id}
            className={`icon-button ${view === item.id ? "active" : ""}`}
            onClick={() => navigate(item.id)}
            aria-label={item.label}
          >
            <Icon size={20} />
          </button>
        );
      })}
    </nav>
  );
}

function Feed(props: {
  identity: Identity | null;
  postBody: string;
  posts: Post[];
  publishPost: (event: FormEvent) => void;
  setPostBody: (value: string) => void;
}) {
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
      <section className="space-y-4">
        <form className="rounded-md border border-line bg-panel/70 p-4 shadow-panel" onSubmit={props.publishPost}>
          <div className="mb-3 flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-md border border-mint/50 bg-mint/10 font-mono text-xs text-mint">
              {props.identity?.publicName.slice(0, 2).toUpperCase() || "??"}
            </div>
            <div>
              <strong>{props.identity?.publicName || "Nom public"}</strong>
              <p className="font-mono text-xs text-muted">post public relié à ton hash, pas à une identité civile</p>
            </div>
          </div>
          <textarea
            className="min-h-28 w-full resize-y rounded-md border border-line bg-ink/55 p-4 leading-7 outline-none placeholder:text-muted/70 focus:border-signal/60"
            maxLength={280}
            value={props.postBody}
            onChange={(event) => props.setPostBody(event.target.value)}
            placeholder="Quoi de neuf ?"
          />
          <div className="mt-3 flex items-center justify-between">
            <span className="font-mono text-xs text-muted">{props.postBody.length}/280</span>
            <button className="outline-button">Publier</button>
          </div>
        </form>

        {props.posts.map((post) => (
          <article key={post.id} className="rounded-md border border-line bg-panel/70 p-5 shadow-panel">
            <header className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <div className="grid h-11 w-11 shrink-0 place-items-center rounded-md border border-signal/40 bg-signal/10 font-mono text-xs text-signal">
                  {post.authorHandle.slice(0, 2).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <strong className="block truncate">{post.authorHandle}</strong>
                  <span className="font-mono text-xs text-muted">
                    hash {short(post.authorHash, 14)} · {relativeTime(post.createdAt)}
                  </span>
                </div>
              </div>
              <Hash className="shrink-0 text-muted" size={18} />
            </header>
            <p className="mt-5 whitespace-pre-wrap leading-8 text-bone/95">{post.body}</p>
            <footer className="mt-5 flex items-center gap-4 border-t border-line pt-4 font-mono text-xs text-muted">
              <button className="text-signal">Répondre</button>
              <span>{post.replies} réponses</span>
              <span>Public</span>
            </footer>
          </article>
        ))}
      </section>

      <aside className="hidden space-y-4 xl:block">
        <InfoCard title="Contrat du feed" copy="Les posts sont publics. Ils sont liés à ton hash public, pas à ton email, ton téléphone ou ton IP applicative." />
        <InfoCard title="Messages privés" copy="Les DMs sont envoyés au backend sous forme iv + cipher. La clé reste dans ton navigateur." />
      </aside>
    </div>
  );
}

function InfoCard({ copy, title }: { copy: string; title: string }) {
  return (
    <article className="rounded-md border border-line bg-panel/60 p-4">
      <strong className="font-serif text-xl">{title}</strong>
      <p className="mt-3 leading-7 text-muted">{copy}</p>
    </article>
  );
}

function Chat(props: {
  activeConversation: Conversation | null;
  identity: Identity | null;
  messageBody: string;
  sendMessage: (event: FormEvent) => void;
  setMessageBody: (value: string) => void;
  startConversation: () => void;
}) {
  return (
    <section className="rounded-md border border-line bg-panel/70 shadow-panel">
      <header className="flex items-center justify-between border-b border-line p-4">
        <div>
          <p className="kicker mb-2">Messages</p>
          <h2 className="font-serif text-3xl font-bold">{props.activeConversation?.peerHandle || "Aucune conversation"}</h2>
          <p className="mt-1 font-mono text-xs text-muted">
            {props.activeConversation ? `${props.activeConversation.messages.length} blobs chiffrés` : "Crée un fil depuis la sidebar"}
          </p>
        </div>
        <button className="outline-button" onClick={props.startConversation}>
          <Plus size={18} /> Nouveau
        </button>
      </header>
      <MessageList conversation={props.activeConversation} identity={props.identity} />
      <form className="flex gap-3 border-t border-line p-4" onSubmit={props.sendMessage}>
        <input
          className="field"
          value={props.messageBody}
          onChange={(event) => props.setMessageBody(event.target.value)}
          placeholder="Message privé chiffré localement"
        />
        <button className="outline-button px-3" aria-label="Envoyer">
          <Send size={18} />
        </button>
      </form>
    </section>
  );
}

function MessageList({ conversation, identity }: { conversation: Conversation | null; identity: Identity | null }) {
  const [plainTexts, setPlainTexts] = useState<Record<string, string>>({});

  useEffect(() => {
    async function decryptAll() {
      if (!conversation) return setPlainTexts({});
      const key = loadChannelKey("dm", conversation.id);
      if (!key) return setPlainTexts({});
      const entries = await Promise.all(
        conversation.messages.map(async (message) => {
          try {
            return [message.id, await decryptText(key, message.encrypted)] as const;
          } catch {
            return [message.id, "Impossible de déchiffrer avec la clé locale"] as const;
          }
        }),
      );
      setPlainTexts(Object.fromEntries(entries));
    }
    decryptAll();
  }, [conversation]);

  if (!conversation) {
    return <div className="min-h-[420px] p-5 text-muted">Aucun fil sélectionné.</div>;
  }

  return (
    <div className="flex min-h-[420px] flex-col gap-4 overflow-auto p-5">
      {conversation.messages.map((message) => {
        const local = message.authorHash === identity?.publicHash;
        return (
          <article
            key={message.id}
            className={`max-w-[760px] rounded-md border p-4 ${
              local ? "ml-auto border-signal/50 bg-signal/10" : "border-violet/45 bg-violet/10"
            }`}
          >
            <p className="leading-7">{plainTexts[message.id] || "Clé locale absente: ciphertext uniquement."}</p>
            <small className="mt-3 block font-mono text-xs text-muted">
              {message.authorHandle} · {relativeTime(message.createdAt)}
            </small>
            <code className="mt-3 block truncate font-mono text-[11px] text-dim">
              cipher {message.encrypted.cipher}
            </code>
          </article>
        );
      })}
    </div>
  );
}

function Groups({ groups, startGroup }: { groups: Group[]; startGroup: () => void }) {
  return (
    <section className="rounded-md border border-line bg-panel/70 p-5 shadow-panel">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="kicker mb-3">Groupes</p>
          <h2 className="font-serif text-4xl font-bold">Salons publics, contenu privé</h2>
        </div>
        <button className="outline-button" onClick={startGroup}>
          <Plus size={18} /> Créer un groupe
        </button>
      </div>
      <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {groups.map((group) => (
          <article key={group.id} className="grid min-h-52 content-between rounded-md border border-mint/30 bg-ink/45 p-5">
            <div>
              <small className="font-mono text-xs text-mint">salon {group.id.slice(0, 8)}</small>
              <h3 className="mt-2 font-serif text-2xl font-bold">{group.name}</h3>
              <p className="mt-4 leading-7 text-muted">{group.topic}</p>
            </div>
            <footer className="mt-5 flex gap-3 border-t border-line pt-4 font-mono text-xs text-muted">
              <span className="shrink-0">{group.memberCount} membres</span>
              <span className="truncate">cipher {group.encryptedIntro.cipher}</span>
            </footer>
          </article>
        ))}
      </div>
    </section>
  );
}

function Security({ health }: { health: Health | null }) {
  const rules = [
    ["Client", "Clés privées et clés AES gardées dans le navigateur. Le backend ne reçoit jamais de secret de déchiffrement."],
    ["Cloudflare", "Pages sert la PWA. Worker applique l'API edge et relaie vers Supabase."],
    ["Supabase", "Postgres stocke les posts publics et les blobs chiffrés, avec RLS et service-role côté Worker."],
    ["À proscrire", "Auth email obligatoire, analytics invasives, logs applicatifs d'IP, reset serveur de clé privée."],
  ];
  return (
    <section className="rounded-md border border-line bg-panel/70 p-5 shadow-panel">
      <p className="kicker mb-3">Sécurité</p>
      <h2 className="font-serif text-4xl font-bold">Architecture réelle</h2>
      <div className="mt-4 rounded-md border border-line bg-ink/45 p-4 font-mono text-sm text-muted">
        État actuel: API {health?.edge === "cloudflare" ? "Cloudflare Worker" : "dev local"} · DB{" "}
        {health?.db === "supabase" ? "Supabase" : "JSON local dev"}
      </div>
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        {rules.map(([title, copy]) => (
          <article key={title} className="rounded-md border border-line bg-ink/45 p-5">
            <strong className="font-serif text-2xl">{title}</strong>
            <p className="mt-4 leading-7 text-muted">{copy}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

export default App;
