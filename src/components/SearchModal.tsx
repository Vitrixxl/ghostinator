import { useEffect } from "react";
import type { Identity, User } from "../types";
import { SearchPanel } from "./Search";

/* Modal plein-écran (mobile) ou large (desktop) qui contient SearchPanel.
   Permet d'ouvrir une nouvelle correspondance depuis Chat sur mobile, où le
   right rail xl: n'est pas accessible. */
export function SearchModal({
  identity,
  onClose,
  onOpen,
}: {
  identity: Identity;
  onClose: () => void;
  onOpen: (user: User) => void | Promise<void>;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch justify-center bg-ink/40 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Chercher un agent"
    >
      <div className="animate-rise-in flex w-full max-w-xl flex-col bg-paper sm:my-6 sm:rounded-none sm:border-2 sm:border-ink">
        <header className="flex items-center justify-between gap-3 border-b-2 border-ink bg-cream px-4 py-3 sm:px-6">
          <div className="min-w-0">
            <p className="kicker">Directoire</p>
            <h2 className="font-display text-2xl font-bold leading-none sm:text-3xl">
              Nouvelle correspondance
            </h2>
          </div>
          <button
            className="btn-icon"
            aria-label="Fermer la recherche"
            onClick={onClose}
          >
            ×
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-4 py-5 sm:px-6">
          <SearchPanel
            identity={identity}
            onOpen={async (user) => {
              await onOpen(user);
              onClose();
            }}
            compact
          />
        </div>
      </div>
    </div>
  );
}
