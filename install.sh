#!/usr/bin/env bash
set -e

UUID="elsa-cute-winstart@elsaballerina.github.io"
DEST="$HOME/.local/share/gnome-shell/extensions/$UUID"

echo "Compiling GSettings schema..."
glib-compile-schemas schemas/

echo "Installing to $DEST..."
rm -rf "$DEST"
mkdir -p "$DEST"
cp -r metadata.json extension.js prefs.js themes.js stylesheet.css schemas "$DEST/"

echo ""
echo "Installed! Next steps:"
echo "  1. Log out and log back in (Wayland requires a fresh session to load new extensions)."
echo "  2. Enable it:  gnome-extensions enable $UUID"
echo "  3. Open settings: gnome-extensions prefs $UUID"
