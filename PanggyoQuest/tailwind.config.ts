import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        pixel: ['"Courier New"', "monospace"],
      },
      colors: {
        dq: {
          bg: "#0a0a1a",
          panel: "#101028",
          border: "#f8f8f8",
          gold: "#ffcf4a",
          blue: "#2a5cff",
        },
      },
      keyframes: {
        blink: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0" },
        },
        floaty: {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-6px)" },
        },
      },
      animation: {
        blink: "blink 1s steps(1) infinite",
        floaty: "floaty 2s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
