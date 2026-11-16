#!/bin/zsh
# أَعُوذُ بِاللَّهِ مِنَ الشَّيْطَانِ الرَّجِيمِ
# بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ
# EVREN Desktop — macOS başlatıcı.
# İlk kullanımda bir kez çalıştırılabilir yapın:  chmod +x EVREN.command
# Sonra Terminal'den ./EVREN.command ile açın; isterseniz Finder'da çift tıklayın.
# Copyright (c) 2026 Yusuf Günay. GNU GPL v3 ya da üzeri; LICENSE ve LICENSE-EK.md'ye bakın.

cd -- "$(dirname -- "$0")" || {
  echo "EVREN Desktop klasörü bulunamadı."
  exit 1
}

if [ ! -x ./node_modules/.bin/electron ]; then
  echo "Bağımlılıklar eksik; kuruluyor (npm install)…"
  if ! command -v npm >/dev/null 2>&1; then
    echo "Node.js bulunamadı. Node.js 20 ya da üzerini kurun: https://nodejs.org"
    read -r "?Kapatmak için Enter'a basın."
    exit 1
  fi
  if ! npm install; then
    echo "Kurulum tamamlanamadı. İnternet bağlantınızı ve Node.js sürümünüzü kontrol edin."
    read -r "?Kapatmak için Enter'a basın."
    exit 1
  fi
fi

if ! ./node_modules/.bin/electron .; then
  echo "Uygulama açılamadı. Claude Code CLI kurulu mu?  npm install -g @anthropic-ai/claude-code"
  read -r "?Kapatmak için Enter'a basın."
  exit 1
fi
