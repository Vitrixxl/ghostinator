import { FormEvent, useCallback, useState } from "react";
import * as api from "../lib/api";
import { shortHash } from "../lib/crypto";
import type { Identity, Post } from "../types";
import { isTurnstileEnabled, TurnstileWidget } from "./Turnstile";
import { Empty, Fleuron, Sigil, Stamp } from "./ui";

const MAX_BODY = 280;

export function Feed({
  identity,
  posts,
  onPost,
}: {
  identity: Identity;
  posts: Post[];
  onPost: (post: Post) => void;
}) {
  return (
    <section className="space-y-8">
      <FeedHeader />
      <Composer identity={identity} onPost={onPost} />
      {posts.length === 0 ? (
        <Empty
          title="Le tirage est vide."
          hint="Soyez le premier à publier un dispatche public."
        />
      ) : (
        <div className="space-y-7">
          {posts.map((post, index) => (
            <Article key={post.id} post={post} index={index + 1} />
          ))}
        </div>
      )}
    </section>
  );
}

function FeedHeader() {
  const today = new Date().toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
  return (
    <header className="border-b-[3px] border-double border-ink pb-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="kicker">Tirage public · Édition courante</p>
          <h2 className="masthead mt-1 text-5xl md:text-6xl">Le Tirage</h2>
        </div>
        <div className="text-right">
          <p className="font-mono text-[10.5px] uppercase tracking-ultra text-ash">{today}</p>
          <p className="mt-1 font-serif italic text-graphite">Imprimé à la maison</p>
        </div>
      </div>
    </header>
  );
}

function Composer({
  identity,
  onPost,
}: {
  identity: Identity;
  onPost: (post: Post) => void;
}) {
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [turnstileToken, setTurnstileToken] = useState<string>("");
  const onTurnstileToken = useCallback((token: string) => setTurnstileToken(token), []);
  const turnstileReady = !isTurnstileEnabled() || turnstileToken.length > 0;

  async function publish(event: FormEvent) {
    event.preventDefault();
    if (!body.trim() || submitting || !turnstileReady) return;
    setSubmitting(true);
    setError(null);
    try {
      const post = await api.createPost({
        authorUsername: identity.username,
        authorHash: identity.publicHash,
        authorPublicKeyEd25519: identity.publicKeyEd25519,
        body: body.trim().slice(0, MAX_BODY),
        turnstileToken: turnstileToken || undefined,
      });
      onPost(post);
      setBody("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={publish} className="leaf p-5">
      <div className="flex items-start gap-4">
        <Sigil text={identity.username} size={48} tone="ink" />
        <div className="flex-1">
          <div className="flex items-center justify-between">
            <p className="font-display text-xl font-semibold leading-none">@{identity.username}</p>
            <Stamp tone="ink" rotate={-3}>Public · non chiffré</Stamp>
          </div>
          <p className="marginalia mt-1">Empreinte {shortHash(identity.publicHash, 6)}</p>
          <textarea
            className="field-block mt-3 min-h-[120px]"
            placeholder="Quel est le dispatche du jour ?"
            value={body}
            onChange={(event) => setBody(event.target.value.slice(0, MAX_BODY))}
            maxLength={MAX_BODY}
          />
          {isTurnstileEnabled() ? (
            <div className="mt-3">
              <TurnstileWidget onToken={onTurnstileToken} />
            </div>
          ) : null}

          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <span
              className={`font-mono text-[11px] font-bold uppercase tracking-ultra ${
                body.length > MAX_BODY - 30 ? "text-stamp" : "text-ash"
              }`}
            >
              {body.length}/{MAX_BODY}
            </span>
            <div className="flex items-center gap-3">
              {error ? (
                <span className="font-mono text-[10.5px] uppercase tracking-ultra text-stamp">{error}</span>
              ) : null}
              <button
                className="btn-stamp"
                type="submit"
                disabled={!body.trim() || submitting || !turnstileReady}
              >
                {submitting ? "Calcul du PoW…" : "Publier"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </form>
  );
}

function Article({ post, index }: { post: Post; index: number }) {
  const date = new Date(post.createdAt);
  const dateStr = date.toLocaleString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  return (
    <article className="leaf p-6 md:p-8">
      <header className="mb-4 flex flex-wrap items-baseline justify-between gap-3 border-b border-rule pb-3">
        <div className="flex items-center gap-3">
          <Sigil text={post.authorUsername} size={40} tone="ink" />
          <div>
            <p className="font-display text-xl font-semibold leading-tight">
              <span className="text-stamp">@</span>
              {post.authorUsername}
            </p>
            <p className="font-mono text-[11px] uppercase tracking-widest text-ash">
              clé {shortHash(post.authorHash, 6)} · {dateStr}
            </p>
          </div>
        </div>
        <span className="dispatch-no">№ {String(index).padStart(3, "0")}</span>
      </header>

      <p className="dropcap font-serif text-[18px] leading-[1.65] text-ink md:text-[19px]">
        {post.body}
      </p>

      <footer className="mt-5 flex items-center justify-between border-t border-rule pt-3">
        <div className="flex items-center gap-4 font-mono text-[11px] uppercase tracking-widest text-ash">
          <button className="hover:text-stamp">↺ Reposter</button>
          <button className="hover:text-stamp">＋ Annoter</button>
        </div>
        <Fleuron glyph="❡" />
      </footer>
    </article>
  );
}
