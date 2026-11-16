#!/usr/bin/env bash
# Publish ranking/Code.gs to the school's Apps Script project (bound to the
# ranking sheet) as a new version of the same web app, so the URL in
# assets/ranking-config.js never changes.
#
# Needs: clasp logged in with the school account (clasp login --no-localhost).
# Usage: ranking/deploy.sh "short description"
#
# The bot's secret is read from ~/.config/chemabot/gamer-ranking-secret and
# pushed only to Google as a private file (Secreto.js). It is never printed and
# never written inside this repository.
set -euo pipefail

SCRIPT_ID="1JZJYWLkzvv8OUG_NuGGEdcV6C-k_k5uddVNnIq4PBXDtKWouX4OwFccW"
DEPLOYMENT_ID="AKfycbyzk_sjkplELhd5JDVMvo0MP6CIFrgUqV6AJmU25gGZIHjI6aYr9Xzx2JbTkDO5g1cK"
SECRET_FILE="${BOT_SECRET_FILE:-$HOME/.config/chemabot/gamer-ranking-secret}"
DESCRIPTION="${1:-Update ranking}"

here="$(cd "$(dirname "$0")" && pwd)"
umask 077
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
cd "$work"

clasp clone "$SCRIPT_ID" >/dev/null
# Keep what is live now, in case we need to go back.
backup="$HOME/backups/ranking-gas/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$backup"
cp -r . "$backup"
echo "Backup of the live script: $backup"

cp "$here/Code.gs" "Código.js"

if [ -s "$SECRET_FILE" ]; then
  secret="$(tr -d '\r\n' < "$SECRET_FILE")"
  if ! [[ "$secret" =~ ^[A-Za-z0-9]{16,}$ ]]; then
    echo "The secret in $SECRET_FILE must be 16 or more letters and digits." >&2
    exit 1
  fi
  printf '// Private: lives only in Apps Script. Never copy it into the repository.\nvar PRIVATE_BOT_SECRET = "%s";\n' "$secret" > Secreto.js
else
  rm -f Secreto.js
  echo "Warning: no $SECRET_FILE, so the bot's protected actions stay off." >&2
fi

clasp push --force >/dev/null
clasp deploy -i "$DEPLOYMENT_ID" -d "$DESCRIPTION" | tail -1
echo "Wait about a minute before testing: the old version keeps answering for a short while."
