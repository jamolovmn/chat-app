import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        "primary": "#006e28",
        "primary-container": "#34c759",
        "on-primary": "#ffffff",
        "on-primary-container": "#004d1a",
        "secondary": "#0058bc",
        "secondary-container": "#0070eb",
        "on-secondary": "#ffffff",
        "tertiary": "#4f4ccd",
        "tertiary-container": "#a6a5ff",
        "on-tertiary": "#ffffff",
        "background": "#faf9fe",
        "surface": "#faf9fe",
        "surface-variant": "#e3e2e7",
        "surface-container": "#eeedf3",
        "surface-container-low": "#f4f3f8",
        "surface-container-high": "#e9e7ed",
        "surface-container-lowest": "#ffffff",
        "on-surface": "#1a1b1f",
        "on-surface-variant": "#3d4a3c",
        "outline": "#6d7b6b",
        "outline-variant": "#bccbb8",
        "error": "#ba1a1a",
        "error-container": "#ffdad6",
        "on-error": "#ffffff",
      },
      borderRadius: {
        "xl": "0.75rem",
        "2xl": "1rem",
        "3xl": "1.5rem",
      },
    },
  },
  plugins: [],
};

export default config;
