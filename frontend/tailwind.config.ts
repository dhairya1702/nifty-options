import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        background: "#0f1117",
        panel: "#1a1d2e",
        accent: "#00d4aa",
        danger: "#ff4757",
        warning: "#ffa502",
        muted: "#9aa4bf",
        border: "rgba(255,255,255,0.08)"
      },
      boxShadow: {
        glow: "0 12px 40px rgba(0, 212, 170, 0.12)"
      }
    }
  },
  plugins: []
};

export default config;
