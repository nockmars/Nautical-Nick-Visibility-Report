import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        "nn-bg": "#0a2a3a",
        "nn-panel": "#0d3347",
        "nn-panel-hover": "#0f3d56",
        "nn-cyan": "#4ad8f5",
        "nn-cyan-bright": "#00e5ff",
        "nn-cyan-dim": "#3ab5d0",
        "nn-orange": "#ff7a2f",
        "nn-green": "#00e676",
        "nn-yellow": "#ffd600",
        "nn-red": "#ff1744",
        "nn-text": "#dff4fa",
        "nn-text-dim": "#7ba9c0",
        "nn-text-muted": "#456a80",
      },
      fontFamily: {
        display: ["Bebas Neue", "Russo One", "sans-serif"],
        body: ["Exo 2", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
