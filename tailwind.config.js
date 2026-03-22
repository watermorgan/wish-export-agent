/* eslint-disable @typescript-eslint/no-require-imports */
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: "var(--color-primary)",
        "primary-soft": "var(--color-primary-soft)",
        secondary: "var(--color-secondary)",
        "secondary-soft": "var(--color-secondary-soft)",
        "success-mint": "var(--color-success-mint)",
        "success-soft": "var(--color-success-soft)",
        "risk-coral": "var(--color-risk-coral)",
        "risk-soft": "var(--color-risk-soft)",
        ivory: "var(--color-ivory)",
        "on-surface": "var(--color-on-surface)",
        surface: "var(--color-surface)",
        outline: "var(--color-outline)",
        "outline-strong": "var(--color-outline-strong)",
        muted: "var(--color-muted)",

        accent: "var(--color-primary)",
        "accent-soft": "var(--color-accent-soft)",
        line: "var(--color-line)",
      },
      fontFamily: {
        headline: ["var(--font-headline)", "sans-serif"],
        body: ["var(--font-body)", "sans-serif"],
        label: ["var(--font-label)", "sans-serif"],
      },
      borderRadius: {
        DEFAULT: "var(--radius-default)",
        lg: "var(--radius-lg)",
        xl: "var(--radius-xl)",
        "2xl": "var(--radius-2xl)",
        full: "9999px",
      },
      boxShadow: {
        soft: "var(--shadow-soft)",
        float: "var(--shadow-float)",
      },
    },
  },
  plugins: [
    require("@tailwindcss/forms"),
    require("@tailwindcss/container-queries"),
  ],
};
