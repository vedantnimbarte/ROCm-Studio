/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#0a0a0c",
        "bg-2": "#0f0f12",
        panel: "#131318",
        "panel-2": "#17171d",
        hairline: "#22222a",
        "hairline-2": "#2c2c36",
        ink: "#ece8dc",
        "ink-2": "#b8b2a3",
        muted: "#6c685c",
        "muted-2": "#4a473e",
        red: {
          DEFAULT: "#ff3a25",
          glow: "#ff3a2533",
        },
        phos: {
          DEFAULT: "#b6ff8a",
          dim: "#b6ff8a44",
        },
        amber: { DEFAULT: "#ffb627" },
        cyan: { DEFAULT: "#7fc8e8" },
        violet: { DEFAULT: "#b59cff" },
      },
      fontFamily: {
        mono: ['"JetBrains Mono"', "ui-monospace", "monospace"],
        sans: ['"Geist"', '"Helvetica Neue"', "sans-serif"],
        serif: ['"Instrument Serif"', '"Times New Roman"', "serif"],
      },
      fontSize: {
        "2xs": "10px",
        "3xs": "9px",
      },
      keyframes: {
        pulse: {
          "0%, 100%": { opacity: "0.9" },
          "50%": { opacity: "0.35" },
        },
        blink: { "50%": { opacity: "0.2" } },
        rise: {
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "none" },
        },
        scroll: {
          to: { transform: "translateX(-50%)" },
        },
      },
      animation: {
        pulse: "pulse 2.4s ease-in-out infinite",
        blink: "blink 1.4s steps(2) infinite",
        rise: "rise 0.6s cubic-bezier(0.2,0.7,0.2,1) forwards",
        scroll: "scroll 60s linear infinite",
      },
    },
  },
  plugins: [],
};
