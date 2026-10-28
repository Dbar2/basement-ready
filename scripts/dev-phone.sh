#!/bin/sh
# Film from your phone against this Mac, with the live 3D: the app over HTTPS on your Wi-Fi.
# Phone cameras only open on HTTPS, so this makes a self-signed certificate for the Mac's address.
# Usage: pnpm dev:phone   (and pnpm dev:scan3d in another terminal for the 3D)
set -e
IP=$(ipconfig getifaddr en0 || ipconfig getifaddr en1)
if [ -z "$IP" ]; then
  echo "No Wi-Fi address found. Connect this Mac to the same Wi-Fi as your phone." >&2
  exit 1
fi
mkdir -p .cert
if [ ! -f ".cert/$IP.pem" ]; then
  openssl req -x509 -newkey rsa:2048 -nodes -days 30 -subj "/CN=Basement Ready dev" \
    -addext "subjectAltName=IP:$IP,DNS:localhost" \
    -keyout ".cert/$IP-key.pem" -out ".cert/$IP.pem" 2>/dev/null
fi
echo ""
echo "  On your phone, on the same Wi-Fi:  https://$IP:5173"
echo "  Your phone will warn about the certificate once. Tap Show Details, then visit the website."
echo ""
PHONE_CERT=".cert/$IP" exec pnpm dev
