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

      // <Wordmark> renders its own next/link anchor. Wrapping it in another
      // <Link> nests <a> inside <a>, which is invalid HTML: the parser closes
      // the outer anchor early, the parsed DOM stops matching React's tree,
      // and every affected page throws a hydration error (minified React
      // error #418) in production. Nineteen page headers shipped that way
      // before it was caught, so make the pattern a lint error rather than a
      // console warning nobody reads.
      "no-restricted-syntax": [
        "error",
        {
          selector:
            'JSXElement[openingElement.name.name="Link"] JSXElement[openingElement.name.name="Wordmark"]',
          message:
            "Wordmark already renders its own link to home. Wrapping it in <Link> nests <a> inside <a> and causes a hydration error. Use <Wordmark href=... /> on its own.",
        },
      ],
    },
  },
]);

export default eslintConfig;
