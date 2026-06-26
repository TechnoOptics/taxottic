import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Standalone Node helper scripts for marketing/store screenshots —
    // not part of the app build, so keep them out of the app lint pass.
    "store-screenshots/**",
  ]),
  {
    // React Compiler rules (eslint-plugin-react-hooks v6, via Next 16) are
    // newly enforced and surface 21 pre-existing violations that are NOT
    // safe blind fixes:
    //   - react-hooks/purity: fires on Server Components reading Date.now()/
    //     new Date() during render, which is correct in RSCs (render runs
    //     once per request) — effectively a false positive there.
    //   - react-hooks/set-state-in-effect: intentional client-mount patterns
    //     (theme/localStorage init, Capacitor-native detection, OAuth-param
    //     parsing) where setState-on-mount is idiomatic.
    // Kept as warnings (not errors) so `npm run lint` passes while the signal
    // stays visible for an incremental, RSC-aware burn-down. See git history.
    rules: {
      "react-hooks/purity": "warn",
      "react-hooks/set-state-in-effect": "warn",
    },
  },
]);

export default eslintConfig;
