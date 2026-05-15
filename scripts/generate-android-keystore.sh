#!/usr/bin/env bash
# Android upload-keystore generator — RUN THIS YOURSELF.
# (bash variant of generate-android-keystore.ps1, for macOS/Linux/WSL.)
#
# The .jks this produces is a CRYPTOGRAPHIC SECRET that IS your
# Android publishing identity. Claude deliberately does not run
# this and never sees the key. You generate it, you hold it.
#
# Prereq: a JDK on PATH (keytool ships with it).
# Usage, from repo root:  ./scripts/generate-android-keystore.sh
set -euo pipefail

KEYSTORE="taxottic-upload.jks"
ALIAS="taxottic-upload"

if [ -f "$KEYSTORE" ]; then
  echo "WARNING: $KEYSTORE already exists. Refusing to overwrite." >&2
  echo "Move the old one aside first if you really mean to regenerate." >&2
  exit 1
fi

echo "Generating $KEYSTORE (alias: $ALIAS) — you'll be prompted for a password + identity fields."
keytool -genkeypair -v \
  -keystore "$KEYSTORE" \
  -keyalg RSA \
  -keysize 4096 \
  -validity 25000 \
  -alias "$ALIAS"

[ -f "$KEYSTORE" ] || { echo "Keystore not created (keytool aborted?)." >&2; exit 1; }

# Git-ignore so it can never be committed by accident.
if ! grep -qxF "$KEYSTORE" .gitignore 2>/dev/null; then
  printf '\n# Android upload keystore — NEVER commit\n%s\n' "$KEYSTORE" >> .gitignore
  echo "Added $KEYSTORE to .gitignore"
fi

B64="$(base64 < "$KEYSTORE" | tr -d '\n')"
echo ""
echo "==================================================================="
echo " NEXT — set the 5 GitHub secrets yourself (gh must be auth'd):"
echo "==================================================================="
cat <<EOF

  printf '%s' '$B64' | gh secret set ANDROID_KEYSTORE
  gh secret set ANDROID_KEYSTORE_PWD --body '<keystore password you just set>'
  gh secret set ANDROID_KEY_ALIAS    --body 'taxottic-upload'
  gh secret set ANDROID_KEY_PWD      --body '<key password (same as keystore unless you set a separate one)>'
  gh secret set PLAY_SERVICE_ACCOUNT --body "\$(cat play-service-account.json)"

Then delete play-service-account.json and store the .jks in a
password manager. Signing setup is done.
EOF
