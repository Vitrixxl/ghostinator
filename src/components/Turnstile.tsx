/* Wrapper Cloudflare Turnstile.
   - Si VITE_TURNSTILE_SITE_KEY est défini, monte le widget officiel et
     remonte le token via onToken.
   - Sinon, mode dev : on remonte immédiatement un token vide ("") qui sera
     ignoré côté serveur (pas de site key Turnstile en dev). */

import { useEffect, useId, useRef } from "react";

const SITE_KEY = (import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined) || "";

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: HTMLElement | string,
        opts: {
          sitekey: string;
          callback: (token: string) => void;
          "error-callback"?: () => void;
          "expired-callback"?: () => void;
          theme?: "light" | "dark" | "auto";
          appearance?: "always" | "execute" | "interaction-only";
        },
      ) => string;
      reset: (id: string) => void;
      remove: (id: string) => void;
    };
  }
}

let scriptPromise: Promise<void> | null = null;

function loadScript() {
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector(
      'script[src*="challenges.cloudflare.com/turnstile"]',
    );
    if (existing) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Impossible de charger Turnstile"));
    document.head.appendChild(script);
  });
  return scriptPromise;
}

export function isTurnstileEnabled() {
  return Boolean(SITE_KEY);
}

export function TurnstileWidget({ onToken }: { onToken: (token: string) => void }) {
  const containerId = useId();
  const widgetIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!SITE_KEY) {
      onToken("");
      return;
    }
    let cancelled = false;
    loadScript()
      .then(() => {
        if (cancelled || !window.turnstile) return;
        const id = window.turnstile.render(`#${CSS.escape(containerId)}`, {
          sitekey: SITE_KEY,
          callback: (token) => onToken(token),
          "expired-callback": () => onToken(""),
          "error-callback": () => onToken(""),
          theme: "light",
        });
        widgetIdRef.current = id;
      })
      .catch(() => {
        // En cas d'échec de chargement, on laisse passer en dev mais le serveur
        // refusera la requête en prod si TURNSTILE_SECRET_KEY est défini.
        onToken("");
      });
    return () => {
      cancelled = true;
      if (widgetIdRef.current && window.turnstile) {
        try {
          window.turnstile.remove(widgetIdRef.current);
        } catch {
          /* ignore */
        }
      }
    };
  }, [containerId, onToken]);

  if (!SITE_KEY) return null;
  return <div id={containerId} className="my-3" />;
}
