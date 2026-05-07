/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#080c18",
        panel: "#0f1728",
        line: "rgba(170,184,204,0.14)",
        bone: "#e7e1d1",
        muted: "#9b958b",
        dim: "#696f7c",
        signal: "#6bbcff",
        ember: "#ff7b2a",
        alarm: "#ff4d37",
        mint: "#64edc2",
        gold: "#caa65d",
        violet: "#b791ff",
      },
      fontFamily: {
        serif: ["Georgia", "Times New Roman", "serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      boxShadow: {
        panel: "0 24px 80px rgba(0, 0, 0, 0.38)",
      },
    },
  },
  plugins: [],
};
