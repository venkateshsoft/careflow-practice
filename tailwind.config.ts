import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: { extend: { colors: { ink: "#102a43", teal: "#0f766e", mist: "#f4f8f7" } } },
  plugins: [],
} satisfies Config;
