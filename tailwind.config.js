/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        paper: "#ede4d0",
        cream: "#f5eedb",
        vellum: "#e3d7bb",
        ink: "#181410",
        graphite: "#2c2520",
        ash: "#5a5147",
        smoke: "#8a8175",
        chalk: "#b8ad99",
        rule: "#c9bfa6",
        ruleSoft: "#d6cdb4",
        stamp: "#b8252b",
        stampDeep: "#8e1c20",
        cipher: "#1f3552",
        cipherSoft: "#43618e",
        sepia: "#7a5b30",
        moss: "#4f6048",
        ochre: "#b88a2c",
      },
      fontFamily: {
        display: ['"Fraunces"', "ui-serif", "Georgia", "serif"],
        serif: ['"Newsreader"', '"Fraunces"', "Georgia", "serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      letterSpacing: {
        wider: "0.08em",
        widest: "0.18em",
        ultra: "0.32em",
      },
      keyframes: {
        "rise-in": {
          "0%": { opacity: "0", transform: "translateY(14px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "fade-in": {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        stamp: {
          "0%": { opacity: "0", transform: "rotate(-12deg) scale(1.6)" },
          "60%": { opacity: "1", transform: "rotate(-7deg) scale(0.95)" },
          "100%": { opacity: "1", transform: "rotate(-7deg) scale(1)" },
        },
        blink: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0" },
        },
        drift: {
          "0%, 100%": { transform: "translate(0,0)" },
          "50%": { transform: "translate(2px, -3px)" },
        },
      },
      animation: {
        "rise-in": "rise-in 0.7s cubic-bezier(0.2, 0.65, 0.25, 1) both",
        "fade-in": "fade-in 0.6s ease-out both",
        stamp: "stamp 0.45s cubic-bezier(0.4, 1.6, 0.6, 1) both",
        blink: "blink 1.1s steps(2, end) infinite",
        drift: "drift 9s ease-in-out infinite",
      },
      boxShadow: {
        leaf: "0 1px 0 rgba(24,20,16,0.05), 0 18px 40px -24px rgba(24,20,16,0.45)",
        stamp: "0 0 0 1.5px currentColor, inset 0 0 0 2px rgba(184,37,43,0.15)",
      },
    },
  },
  plugins: [],
};
