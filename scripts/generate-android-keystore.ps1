# Android upload-keystore generator — RUN THIS YOURSELF.
#
# This creates the private signing key for the Android app. The
# .jks file it produces is a CRYPTOGRAPHIC SECRET. Whoever holds it
# can publish updates as you. Claude deliberately does NOT run this
# and never sees the key — you generate it, you hold it.
#
# Prereqts: a JDK on PATH (keytool ships with it). Check:
#   keytool -help
# If missing: install Temurin JDK 21 (https://adoptium.net).
#
# Usage (PowerShell, from the repo root):
#   ./scripts/generate-android-keystore.ps1
#
# It will:
#   1. Prompt you for a keystore password (remember it — it is
#      unrecoverable; losing it means you can never update the app
#      unless Play App Signing is enabled, which is why we enable it)
#   2. Generate taxottic-upload.jks (25,000-day validity)
#   3. Base64-encode it and copy to your clipboard
#   4. Print the EXACT `gh secret set` commands to run (you run
#      them so the values never pass through anyone else)
#
# After running, the .jks is git-ignored (see the .gitignore line
# this script appends). Back it up somewhere safe and private
# (password manager / encrypted drive). Do NOT commit it.

$ErrorActionPreference = "Stop"

$keystore = "taxottic-upload.jks"
$alias    = "taxottic-upload"

if (Test-Path $keystore) {
  Write-Host "WARNING: $keystore already exists. Refusing to overwrite." -ForegroundColor Yellow
  Write-Host "If you intend to regenerate, move the old one aside first."
  exit 1
}

Write-Host "Generating $keystore (alias: $alias)..." -ForegroundColor Cyan
Write-Host "You'll be prompted for a password and a few identity fields."
Write-Host "The identity fields can be anything reasonable (org name, city)."
Write-Host ""

# 4096-bit RSA, ~68-year validity so the upload key never expires
# under you. keytool prompts interactively for the password + DN.
keytool -genkeypair -v `
  -keystore $keystore `
  -keyalg RSA `
  -keysize 4096 `
  -validity 25000 `
  -alias $alias

if (-not (Test-Path $keystore)) {
  Write-Host "Keystore was not created (keytool aborted?)." -ForegroundColor Red
  exit 1
}

# Git-ignore the keystore so it can never be committed by accident.
$gitignore = ".gitignore"
$ignoreLine = "taxottic-upload.jks"
if (-not (Select-String -Path $gitignore -SimpleMatch $ignoreLine -Quiet)) {
  Add-Content -Path $gitignore -Value "`n# Android upload keystore — NEVER commit`n$ignoreLine"
  Write-Host "Added $ignoreLine to .gitignore" -ForegroundColor Green
}

# Base64 the keystore for the GitHub secret.
$b64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($keystore))
Set-Clipboard -Value $b64
Write-Host ""
Write-Host "Base64 of the keystore is now on your clipboard." -ForegroundColor Green
Write-Host ""
Write-Host "==================================================================="
Write-Host " NEXT: set the 5 GitHub secrets. Run these YOURSELF (gh auth'd):"
Write-Host "==================================================================="
Write-Host ""
Write-Host "  # 1. The keystore (already on clipboard):"
Write-Host "  gh secret set ANDROID_KEYSTORE --body (Get-Clipboard)"
Write-Host ""
Write-Host "  # 2-4. Passwords/alias (replace the <...> with what you chose):"
Write-Host "  gh secret set ANDROID_KEYSTORE_PWD --body '<the keystore password you just set>'"
Write-Host "  gh secret set ANDROID_KEY_ALIAS    --body 'taxottic-upload'"
Write-Host "  gh secret set ANDROID_KEY_PWD      --body '<key password — same as keystore unless you set a separate one>'"
Write-Host ""
Write-Host "  # 5. Play service-account JSON (see OPERATOR_CHECKLIST step 4):"
Write-Host "  gh secret set PLAY_SERVICE_ACCOUNT --body (Get-Content play-service-account.json -Raw)"
Write-Host ""
Write-Host "Then DELETE play-service-account.json locally and store the .jks"
Write-Host "in a password manager. You're done with signing setup."
