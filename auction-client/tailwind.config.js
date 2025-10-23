/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bgDark: "#1b1e22",
        panel: "#2a2e33",
        accent: "#26c6da",
        accentDark: "#0097a7",
        textMain: "#e0e0e0",
        textSub: "#9ea7ad"
      }
    }
  },
  plugins: []
}
