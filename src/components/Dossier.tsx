import { useState } from "react";
import { clearIdentity, identityExport, shortHash } from "../lib/crypto";
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
    clearIdentity();
    onLogout();
  }

  return (
    <section>
      <header className="border-b-[3px] border-double border-ink pb-3">
        <p className="kicker">Pièce confidentielle</p>
        <h2 className="masthead text-5xl">Dossier d'agent</h2>
        <p className="marginalia mt-1">
          État de votre identité. Ces clés vivent dans <code className="font-mono">localStorage</code> de ce navigateur.
        </p>
      </header>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_1.4fr]">
        <article className="leaf relative p-6">
          <div className="absolute -right-3 -top-3 animate-stamp">
            <Stamp tone="stamp" rotate={-7}>Vérifié</Stamp>
          </div>
          <Sigil text={identity.username} size={88} tone="stamp" />
          <h3 className="masthead mt-4 text-4xl">@{identity.username}</h3>
          <p className="mt-1 font-mono text-[11px] uppercase tracking-ultra text-ash">
            créé {new Date(identity.createdAt).toLocaleDateString("fr-FR")}
          </p>
          <dl className="mt-5 space-y-3">
            <div>
              <dt className="kicker">Empreinte</dt>
              <dd className="font-mono text-[12px] text-graphite">{shortHash(identity.publicHash, 12)}</dd>
            </div>
            <div>
              <dt className="kicker">Algorithme</dt>
              <dd className="font-mono text-[12px] text-graphite">ECDH P-256 · AES-GCM 256</dd>
            </div>
            <div>
              <dt className="kicker">Stockage</dt>
              <dd className="font-mono text-[12px] text-graphite">navigateur (local)</dd>
            </div>
          </dl>
        </article>

        <article className="space-y-4">
          <CopyBox label="Empreinte (sha-256)" value={identity.publicHash} />
          <CopyBox label="Clé publique (raw, base64)" value={identity.publicKey} />
          <div>
            <CopyBox
              label="Clé privée (jwk)"
              value={JSON.stringify(identity.privateJwk, null, 2)}
              multiline
              reveal={reveal}
            />
            <button
              type="button"
              className="mt-2 font-mono text-[10.5px] font-bold uppercase tracking-ultra text-cipher hover:underline"
              onClick={() => setReveal(!reveal)}
            >
              {reveal ? "◐ Masquer" : "◑ Révéler"} la clé privée
            </button>
          </div>
          <CopyBox label="Export complet (json)" value={identityExport(identity)} multiline reveal={reveal} />

          <div className="leaf border-stamp/60 p-4">
            <Stamp tone="stamp" rotate={-2}>Zone rouge</Stamp>
            <p className="marginalia mt-3">
              Effacer ce dossier supprime votre identité de ce navigateur. Sans la clé privée sauvegardée,
              vous ne pourrez plus déchiffrer vos correspondances précédentes.
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
