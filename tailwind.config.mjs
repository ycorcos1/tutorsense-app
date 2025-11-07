import forms from "@tailwindcss/forms";

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./pages/**/*.{ts,tsx}",
    "./src/**/*.{ts,tsx}",
    "./public/**/*.html",
  ],
  theme: {
    extend: {
      colors: {
        score: {
          good: "#166534",
          warn: "#b45309",
          bad: "#b91c1c",
        },
        trend: {
          blue: "#2563eb",
          purple: "#6d28d9",
          fill: "#dbeafe",
        },
      },
    },
  },
  plugins: [forms],
};
