#!/bin/zsh
# أَعُوذُ بِاللَّهِ مِنَ الشَّيْطَانِ الرَّجِيمِ
# بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ
# EVREN Desktop — macOS başlatıcı (ince kabuk).
# Başlatma mantığı tek yerde: basla.js (Windows karşılığı EVREN.bat da aynı dosyayı çağırır).
# İlk kullanımda bir kez:  chmod +x EVREN.command — sonra Terminal'den ./EVREN.command ya da Finder'da çift tık.
# Copyright (c) 2026 Yusuf Günay. GNU GPL v3 ya da üzeri; LICENSE ve LICENSE-EK.md'ye bakın.

cd -- "$(dirname -- "$0")" || { echo "EVREN Desktop klasörü bulunamadı."; exit 1; }

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js bulunamadı. Node.js 20 ya da üzerini kurun: https://nodejs.org"
  read -r "?Kapatmak için Enter'a basın."
  exit 1
fi

if ! node ./basla.js --hazirla; then
  read -r "?Kapatmak için Enter'a basın."
  exit 1
fi

exec node ./basla.js
