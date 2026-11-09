# Devir

## 2026-11-09 · oturum süreç ağacı ve boşta kapatma
Yapıldı: `kabukKapat` artık `taskkill /T /F` ile tüm ağacı kapatıyor; `before-quit` eklendi; boşta kapatma kararı ajana bırakıldı (`sohbet.oturumDurumu`: son tur metin mi, araç askıda mı) + süreç ağacında MCP dışı çalışan var mı + kullanıcı son 60 dk yazdı mı; Şef brifine "iş bitince worker'ları kapat ve DEVIR notu düş" kuralı eklendi.
Doğrulama: `node --check main.js sohbet.js` temiz; 8 gerçek jsonl üzerinde sınıflandırma çalıştı.
Sıradaki: `npm run basla` ile açıp boşta kapatmayı bir kez gözle doğrula.
Açık: 60 dk eşiği `bostaKapatDk` ayarıyla değişir.
Commit: ce454b4 + devir-notu kuralı
