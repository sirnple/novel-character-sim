import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        prose: ["var(--font-prose)", "Georgia", "serif"],
        mono: ["ui-monospace", "Cascadia Code", "SF Mono", "Menlo", "monospace"],
      },
      fontSize: {
        "2xs": ["0.75rem", { lineHeight: "1.25rem" }], // 12px floor
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        panel: {
          DEFAULT: "hsl(var(--panel))",
          elevated: "hsl(var(--panel-elevated))",
        },
        paper: {
          DEFAULT: "hsl(var(--paper))",
          foreground: "hsl(var(--paper-foreground))",
          line: "hsl(var(--paper-line))",
        },
        ember: {
          DEFAULT: "hsl(var(--ember))",
          soft: "hsl(var(--ember-soft))",
        },
        mist: "hsl(var(--mist))",
        fog: "hsl(var(--fog))",
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      boxShadow: {
        paper: "0 8px 32px -8px rgba(0, 0, 0, 0.45), 0 2px 8px -2px rgba(0, 0, 0, 0.25)",
      },
    },
  },
  plugins: [],
};
export default config;
