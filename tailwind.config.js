import forms from '@tailwindcss/forms';
import containerQueries from '@tailwindcss/container-queries';

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        "primary": "#818cf8", // Periwinkle Blue (Indigo-400)
        "secondary": "#fda4af", // Peach Pink (Rose-300)
        "success-mint": "#34d399", // Mint Green
        "risk-coral": "#fb923c", // Coral Orange
        "ivory": "#f9fafb", // Ivory White (bg-stone-50 approach)
        "surface": "#ffffff",
        "on-surface": "#1e293b",
        "outline": "#94a3b8"
      },
      fontFamily: {
        "headline": ["Manrope", "sans-serif"],
        "body": ["Manrope", "sans-serif"],
        "label": ["Plus Jakarta Sans", "sans-serif"]
      },
      boxShadow: {
        "soft": "0 4px 20px -2px rgba(0, 0, 0, 0.05)",
        "float": "0 10px 30px -5px rgba(129, 140, 248, 0.15)"
      }
    },
  },
  plugins: [
    forms,
    containerQueries,
  ],
}

