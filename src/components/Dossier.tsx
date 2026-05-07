import { useState } from "react";
import { identityExport, shortHash } from "../lib/crypto";
import type { Identity } from "../types";
import { CopyBox, Sigil, Stamp } from "./ui";

export function Dossier({
  identity,
  onLogout,
}: {
  identity: Identity;
  onLogout: () => void;
}) {
  const [reveal, setReveal] = useState(false);
  const [confirming, setConfirming] = useState(false);

  function confirmLogout() {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    onLogout();
  }

  return (
    <section>
      <header className="border-b-[3px] border-double border-ink pb-3">
        <p className="kicker">Pièce confidentielle</p>
        <h2 className="masthead text-3xl sm:text-4xl md:text-5xl">Dossier d'agent</h2>
        <p className="marginalia mt-1">
          État de votre identité. Vos clés privées vivent chiffrées dans IndexedDB de ce
          navigateur, déverrouillées uniquement par votre mot de passe local.
        </p>
      </header>

      <div className="mt-5 grid gap-5 sm:mt-6 sm:gap-6 lg:grid-cols-[1fr_1.4fr]">
        <article className="leaf relative p-4 sm:p-6">
          <div className="absolute -right-2 -top-2 animate-stamp sm:-right-3 sm:-top-3">
            <Stamp tone="stamp" rotate={-7}>Vérifié</Stamp>
          </div>
          <Sigil text={identity.username} size={64} tone="stamp" />
          <h3 className="masthead mt-3 break-words text-2xl sm:mt-4 sm:text-3xl md:text-4xl">
            @{identity.username}
          </h3>
          <p className="mt-1 font-mono text-[11px] uppercase tracking-ultra text-ash">
            créé {new Date(identity.createdAt).toLocaleDateString("fr-FR")}
          </p>
          <dl className="mt-5 space-y-3">
            <div>
              <dt className="kicker">Empreinte</dt>
              <dd className="font-mono text-[12px] text-graphite">
                {shortHash(identity.publicHash, 12)}
              </dd>
            </div>
            <div>
              <dt className="kicker">Signature d'auth</dt>
              <dd className="font-mono text-[12px] text-graphite">Ed25519 (WebCrypto)</dd>
            </div>
            <div>
              <dt className="kicker">DM E2EE</dt>
              <dd className="font-mono text-[12px] text-graphite">X25519 ECDH · AES-GCM 256</dd>
            </div>
            <div>
              <dt className="kicker">Stockage</dt>
              <dd className="font-mono text-[12px] text-graphite">
                IndexedDB chiffrée · PBKDF2 210k
              </dd>
            </div>
          </dl>
        </article>

        <article className="space-y-4">
          <CopyBox label="Empreinte (sha-256)" value={identity.publicHash} />
          <CopyBox label="Clé publique Ed25519 (raw, base64)" value={identity.publicKeyEd25519} />
          <CopyBox label="Clé publique X25519 (raw, base64)" value={identity.publicKeyX25519} />
          <CopyBox
            label="Export complet (à sauvegarder hors ligne)"
            value={identityExport(identity)}
            multiline
            reveal={reveal}
          />
          <button
            type="button"
            className="font-mono text-[10.5px] font-bold uppercase tracking-ultra text-cipher hover:underline"
            onClick={() => setReveal(!reveal)}
          >
            {reveal ? "Masquer" : "Révéler"} l'export complet
          </button>

          <div className="leaf border-stamp/60 p-4">
            <Stamp tone="stamp" rotate={-2}>Zone rouge</Stamp>
            <p className="marginalia mt-3">
              Effacer ce dossier supprime votre identité de ce navigateur. Sans l'export
              hors ligne et sans votre mot de passe local, vous ne pourrez plus déchiffrer
              vos correspondances précédentes.
            </p>
            <button className="btn-stamp mt-4" onClick={confirmLogout}>
              {confirming ? "Confirmer l'effacement" : "Effacer le dossier"}
            </button>
            {confirming ? (
              <button className="btn-ghost ml-2 mt-4" onClick={() => setConfirming(false)}>
                Annuler
              </button>
            ) : null}
          </div>
        </article>
      </div>
    </section>
  );
}
