// Component-test mount entry. Importing the app's global stylesheet brings
// the real Tailwind v4 theme (forest/gold/cream + fonts) into the harness so
// mounted components render with their production styles — otherwise the
// screenshots would capture unstyled markup and catch nothing.
import "../app/globals.css";
