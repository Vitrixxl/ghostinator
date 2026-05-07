import { FormEvent, useCallback, useState } from "react";
import * as api from "../lib/api";
import {
  activateIdentity,
  createIdentity,
  identityExport,
  shortHash,
} from "../lib/crypto";
import type { Identity } from "../types";
import { isTurnstileEnabled, TurnstileWidget } from "./Turnstile";
import { CopyBox, Fleuron, Masthead, Sigil, Stamp } from "./ui";

type Stage = "alias" | "minting" | "dossier";

export function Onboarding({ onReady }: { onReady: (identity: Identity) => Promise<void> | void }) {
  const [stage, setStage] = useState<Stage>("alias");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedAck, setSavedAck] = useState(false);
  const [revealPrivate, setRevealPrivate] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string>("");
  const [progress, setProgress] = useState<string>("");

  const validUsername = /^[a-zA-Z0-9_.\-]{2,32}$/.test(username);
  const validPassword = password.length >= 10 && password === passwordConfirm;
  const turnstileReady = !isTurnstileEnabled() || turnstileToken.length > 0;

  const onTurnstileToken = useCallback((token: string) => setTurnstileToken(token), []);

  async function startMint(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!validUsername) {
      setError("2 à 32 caractères, lettres / chiffres / _ . - uniquement");
      return;
    }
    if (!validPassword) {
      setError("Mot de passe local : 10 caractères minimum, et identique dans les deux champs.");
      return;
    }
    setStage("minting");
    try {
      setProgress("Forge des keypairs Ed25519 + X25519…");
      const fresh = await createIdentity(username, password);
      await activateIdentity(fresh, password);
      setProgress("Calcul de la preuve de travail (PoW ~18 bits)…");
      await api.registerUser({
        username: fresh.username,
        publicHash: fresh.publicHash,
        publicKeyEd25519: fresh.publicKeyEd25519,
        publicKeyX25519: fresh.publicKeyX25519,
        turnstileToken: turnstileToken || undefined,
      });
      setIdentity(fresh);
      setStage("dossier");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
      setStage("alias");
    } finally {
      setProgress("");
    }
  }

  async function enterBureau() {
    if (!identity) return;
    await onReady(identity);
  }

  return (
    <div className="relative min-h-screen overflow-hidden">
      <DecorativeRules />

      <div className="relative mx-auto grid min-h-screen w-full max-w-[1180px] grid-rows-[auto_1fr_auto] px-4 py-6 sm:px-6 sm:py-8 md:px-10">
        <header className="animate-fade-in border-b-[3px] border-double border-ink pb-4 sm:pb-5">
          <div className="flex flex-wrap items-end justify-between gap-2 sm:gap-3">
            <div className="min-w-0 flex-1">
              <p className="kicker">Bureau privé · Vol. I</p>
              <Masthead size="xl" />
            </div>
            <div className="shrink-0 text-right font-mono text-[10px] uppercase tracking-ultra text-ash sm:text-[11px]">
              <p>Éd. №001</p>
              <p>Anno {new Date().getFullYear()}</p>
              <p className="text-stamp">Confidentiel</p>
            </div>
          </div>
          <p className="mt-2 font-serif italic text-sm text-graphite sm:text-base">
            « Réseau de correspondance chiffrée — clés générées localement, jamais transmises. »
          </p>
        </header>

        <main className="grid grid-cols-1 gap-8 py-8 sm:gap-10 sm:py-10 md:grid-cols-[1.2fr_1fr] md:py-12">
          <section className="animate-rise-in" style={{ animationDelay: "120ms" }}>
            <Stamp tone="stamp" rotate={-3}>Étape {stage === "alias" || stage === "minting" ? "1" : "2"} / 2</Stamp>
            <h2 className="masthead mt-4 text-3xl sm:mt-5 sm:text-4xl md:text-5xl xl:text-6xl">
              {stage === "dossier"
                ? "Votre dossier vient d'être ouvert"
                : "Forger une identité anonyme"}
            </h2>
            <p className="marginalia mt-4 max-w-md">
              {stage === "dossier"
                ? "Une paire Ed25519 (signature) et une paire X25519 (DM E2EE) ont été forgées dans votre navigateur. Le serveur n'a reçu que les clés publiques."
                : "Choisissez un alias public et un mot de passe local. Le mot de passe chiffre votre clé privée dans IndexedDB ; il n'est jamais transmis."}
            </p>

            {stage !== "dossier" ? (
              <form onSubmit={startMint} className="mt-6 max-w-md sm:mt-10">
                <div>
                  <label className="kicker mb-1 block">Alias public</label>
                  <input
                    autoFocus
                    autoComplete="off"
                    spellCheck={false}
                    className="field"
                    placeholder="ex. owl.scribe"
                    value={username}
                    onChange={(event) => {
                      setUsername(event.target.value);
                      setError(null);
                    }}
                    maxLength={32}
                    disabled={stage === "minting"}
                  />
                  <p className="marginalia mt-2">
                    {username.length}/32 — lettres, chiffres, <code className="font-mono">_ . -</code>
                  </p>
                </div>

                <div className="mt-6">
                  <label className="kicker mb-1 block">Mot de passe local (≥ 10 caractères)</label>
                  <input
                    type="password"
                    autoComplete="new-password"
                    className="field"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={stage === "minting"}
                  />
                </div>
                <div className="mt-3">
                  <label className="kicker mb-1 block">Confirmation</label>
                  <input
                    type="password"
                    autoComplete="new-password"
                    className="field"
                    value={passwordConfirm}
                    onChange={(e) => setPasswordConfirm(e.target.value)}
                    disabled={stage === "minting"}
                  />
                  <p className="marginalia mt-2">
                    Sert uniquement à chiffrer votre clé privée dans ce navigateur. Jamais transmis.
                  </p>
                </div>

                {isTurnstileEnabled() ? (
                  <div className="mt-6">
                    <label className="kicker mb-1 block">Vérification anti-bot (Turnstile)</label>
                    <TurnstileWidget onToken={onTurnstileToken} />
                  </div>
                ) : null}

                {error ? (
                  <p className="mt-3 inline-flex border-2 border-stamp bg-stamp/5 px-2 py-1 font-mono text-[11px] font-bold uppercase tracking-ultra text-stamp">
                    {error}
                  </p>
                ) : null}

                {progress ? (
                  <p className="mt-3 font-mono text-[11px] uppercase tracking-ultra text-cipher">
                    {progress}
                  </p>
                ) : null}

                <div className="mt-8 flex flex-wrap items-center gap-4">
                  <button
                    className="btn-stamp"
                    type="submit"
                    disabled={
                      !validUsername ||
                      !validPassword ||
                      !turnstileReady ||
                      stage === "minting"
                    }
                  >
                    {stage === "minting" ? "Forge en cours…" : "Forger mes paires de clés"}
                  </button>
                  <span className="marginalia">
                    Aucun email ni numéro de téléphone n'est requis.
                  </span>
                </div>
              </form>
            ) : null}

            {stage === "dossier" && identity ? (
              <Dossier
                identity={identity}
                savedAck={savedAck}
                setSavedAck={setSavedAck}
                revealPrivate={revealPrivate}
                setRevealPrivate={setRevealPrivate}
                onContinue={enterBureau}
              />
            ) : null}
          </section>

          <aside
            className="space-y-5 animate-rise-in border-t border-rule pt-6 sm:space-y-6 md:border-l md:border-t-0 md:pl-6 md:pt-0 lg:pl-10"
            style={{ animationDelay: "240ms" }}
          >
            <Pillar
              n="I."
              title="DM bout-en-bout"
              copy="Chaque DM est chiffré côté client via X25519 ECDH + AES-GCM 256. Le serveur n'enregistre que iv + cipher."
            />
            <Pillar
              n="II."
              title="Auth sans identité"
              copy="Chaque requête est signée par votre clé Ed25519. Pas de mot de passe serveur, pas de session. L'identifiant est sha256(votre clé publique)."
            />
            <Pillar
              n="III."
              title="Mot de passe local"
              copy="Votre clé privée vit chiffrée dans IndexedDB par AES-GCM dérivé de ce mot de passe via PBKDF2 210 000 itérations. Il ne quitte jamais votre appareil."
            />

            <div className="leaf p-5">
              <Stamp tone="cipher" rotate={2}>Architecture</Stamp>
              <ul className="mt-4 space-y-2 font-mono text-[11.5px] text-graphite">
                <li>· Front PWA — Cloudflare Pages</li>
                <li>· API edge — Cloudflare Worker</li>
                <li>· Base de données — Supabase Postgres EU</li>
                <li>· Crypto — WebCrypto natif (Ed25519 + X25519)</li>
              </ul>
            </div>
          </aside>
        </main>

        <footer className="border-t border-double border-ink pt-4 text-center font-mono text-[10.5px] uppercase tracking-ultra text-ash">
          <Fleuron glyph="❦" />
          <p className="mt-3">Ghostinator — Bureau of Encrypted Correspondence</p>
        </footer>
      </div>
    </div>
  );
}

function Pillar({ n, title, copy }: { n: string; title: string; copy: string }) {
  return (
    <article>
      <div className="flex items-baseline gap-3">
        <span className="font-display text-2xl italic text-stamp sm:text-3xl">{n}</span>
        <h3 className="font-display text-xl font-semibold leading-tight text-ink sm:text-2xl">
          {title}
        </h3>
      </div>
      <p className="marginalia mt-2">{copy}</p>
    </article>
  );
}

function Dossier({
  identity,
  savedAck,
  setSavedAck,
  revealPrivate,
  setRevealPrivate,
  onContinue,
}: {
  identity: Identity;
  savedAck: boolean;
  setSavedAck: (v: boolean) => void;
  revealPrivate: boolean;
  setRevealPrivate: (v: boolean) => void;
  onContinue: () => void;
}) {
  const exportJson = identityExport(identity);
  return (
    <div className="relative mt-6 max-w-2xl sm:mt-8">
      <div className="absolute -right-2 -top-2 z-10 animate-stamp sm:-right-4 sm:-top-4">
        <span className="stamp-classified">Confidentiel</span>
      </div>

      <div className="leaf p-4 sm:p-6">
        <header className="flex items-start justify-between gap-3 border-b border-rule pb-3 sm:items-center sm:gap-4 sm:pb-4">
          <div className="flex min-w-0 items-center gap-3">
            <Sigil text={identity.username} size={48} tone="stamp" />
            <div className="min-w-0">
              <p className="kicker">Alias enregistré</p>
              <p className="truncate font-display text-2xl font-bold leading-none sm:text-3xl">
                @{identity.username}
              </p>
              <p className="mt-1 truncate font-mono text-[11px] text-ash">
                Empreinte {shortHash(identity.publicHash, 8)}
              </p>
            </div>
          </div>
          <span className="hidden shrink-0 sm:inline-flex">
            <Stamp tone="cipher" rotate={4}>Ed25519 + X25519</Stamp>
          </span>
        </header>

        <div className="mt-5 space-y-4">
          <CopyBox label="Empreinte publique (sha-256)" value={identity.publicHash} />
          <CopyBox label="Clé publique Ed25519 (raw, base64)" value={identity.publicKeyEd25519} />
          <CopyBox label="Clé publique X25519 (raw, base64)" value={identity.publicKeyX25519} />
          <CopyBox
            label="Export complet chiffré (à sauvegarder hors ligne)"
            value={exportJson}
            multiline
            reveal={revealPrivate}
          />
          <button
            type="button"
            className="font-mono text-[10.5px] font-bold uppercase tracking-ultra text-cipher hover:underline"
            onClick={() => setRevealPrivate(!revealPrivate)}
          >
            {revealPrivate ? "Masquer" : "Révéler"} l'export complet
          </button>
        </div>

        <label className="mt-6 flex cursor-pointer items-start gap-3 border-2 border-dashed border-stamp/60 p-3">
          <input
            type="checkbox"
            className="mt-1 h-4 w-4 accent-[#b8252b]"
            checked={savedAck}
            onChange={(event) => setSavedAck(event.target.checked)}
          />
          <span className="font-mono text-[11px] uppercase tracking-widest text-graphite">
            J'ai sauvegardé mon export hors ligne. Sans lui ni mon mot de passe local, mon compte est irrécupérable.
          </span>
        </label>

        <div className="mt-6 flex flex-wrap items-center gap-4">
          <button className="btn-stamp" disabled={!savedAck} onClick={onContinue}>
            Entrer au bureau →
          </button>
          <span className="marginalia">L'identité est stockée chiffrée dans IndexedDB de ce navigateur.</span>
        </div>
      </div>
    </div>
  );
}

function DecorativeRules() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <div
        className="absolute left-0 top-0 hidden h-full w-px bg-rule md:block"
        style={{ left: "min(40px, 4vw)" }}
      />
      <div
        className="absolute right-0 top-0 hidden h-full w-px bg-rule md:block"
        style={{ right: "min(40px, 4vw)" }}
      />
      <span className="absolute left-2 top-8 hidden font-mono text-[10px] uppercase tracking-ultra text-chalk md:block">
        №001
      </span>
      <span className="absolute right-2 bottom-8 hidden font-mono text-[10px] uppercase tracking-ultra text-chalk md:block">
        Page 01
      </span>
    </div>
  );
}
