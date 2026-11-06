import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Dialog forms reset their state when opened and the focus timer restores from
      // localStorage; both are intentional effect-driven state syncs.
      "react-hooks/set-state-in-effect": "warn",
    },
  },
  globalIgnores(["supabase/**", "tests/**", "public/sw.js"]),
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
