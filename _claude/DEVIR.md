# Devir

## 2026-11-09 · oturum süreç ağacı ve boşta kapatma
Yapıldı: `kabukKapat` artık `taskkill /T /F` ile tüm ağacı kapatıyor; `before-quit` eklendi; boşta kapatma kararı ajana bırakıldı (`sohbet.oturumDurumu`: son tur metin mi, araç askıda mı) + süreç ağacında MCP dışı çalışan var mı + kullanıcı son 60 dk yazdı mı; Şef brifine "iş bitince worker'ları kapat ve DEVIR notu düş" kuralı eklendi.
Doğrulama: `node --check main.js sohbet.js` temiz; 8 gerçek jsonl üzerinde sınıflandırma çalıştı.
Sıradaki: `npm run basla` ile açıp boşta kapatmayı bir kez gözle doğrula.
Açık: 60 dk eşiği `bostaKapatDk` ayarıyla değişir.
Commit: ce454b4 + devir-notu kuralı

## 2026-11-10 · alt çubuk bağlam/sayaç/künye
Yapıldı: alt çubukta model + gerçek bağlam kullanımı (`82.6K / 1M · %7.9`) + asistan tur sayacı; aktif oturumun jsonl kaydından artımlı okunur, oturum yokken üçü de gizlenir; künye `EVREN v0.4.0 · MPL-2.0 · © 2026 Yusuf GÜNAY` ve GitHub'a tıklanır.
Doğrulama: `npm test` 7/7 yeşil; ikinci Electron örneğinde 1240 px'te taşma yok.
Sıradaki: yok · Açık: `remote-sunucu.js` onay tespiti değişikliği ayrı iş olarak commit bekliyor.
Commit: bb300bf

## 2026-11-10 · açık sohbetin ikinci kez açılması
Yapıldı: soldaki karta tıklamak, üstte zaten açık sohbeti yeniden başlatmıyor; mevcut panele yönlendirip kısa vurgu veriyor. Canlı eş varsa sekmesine gidiliyor, kapanmış sekme yerinde tazeleniyor (ikinci sekme yok).
Doğrulama: `node --check app.js` temiz, `npm test` 7/7 yeşil.
Sıradaki: `npm run basla` ile karta tıklama akışını bir kez gözle doğrula.
Commit: d13638e

## 2026-11-10 · Şef oturumu telefonda ayrı etiket
Yapıldı: oturum listesine `orkestrator` bayrağı eklendi; telefonda `OturumDurumu.sef` taşınır, liste kartı ve detay üst çubuğunda mono `ŞEF` etiketi çizilir (rozet değil, hairline dil).
Doğrulama: masaüstü `npm test` 12/12 yeşil; telefon `testDebugUnitTest assembleDebug` BUILD SUCCESSFUL.
Sıradaki: `docs/ekran-ana.png`, `ekran-oturum.png`, `ekran-palet.png` güncel arayüzle yenilenecek (kullanıcı erteledi).
Açık: Etiketin görünme yarısı yalnız birim testiyle kanıtlı; canlı Şef oturumuyla ekran görüntüsü alınmadı.
Commit: 3ed0d2d (masaüstü) + 9aec334 (telefon)

## 2026-11-10 · Telefonda soru seçenekleri + yeni soru sesi
Yapıldı: AskUserQuestion girdisi özet metne kırpılmak yerine `arac.sorular` olarak taşınıyor; araç dönüşü `sonuc:true` ile sahte bekleyen soru üretmiyor. Telefon seçenekleri düğme olarak çiziyor, dokunuş ok tuşu taklidiyle gerçek terminal seçimi yapıyor. Soru bildirimi 0.8 sn alçak iki vuruşlu konsol tonu (kanal v4) + iki vuruşlu titreşim.
Doğrulama: masaüstü `npm test` 16/16; telefon `testDebugUnitTest assembleDebug` 89/89 ve BUILD SUCCESSFUL; APK gerçek cihaza kuruldu.
Sıradaki: canlı bir soruyla telefonda seçenek dokunuşunu ve sesi bir kez gözle/kulakla doğrula.
Açık: soru bulunamazsa yeniden deneme zamanlayıcısı artık unref (süreç askıda kalmıyor); kökteki `oturum-karar.js` kullanılmayan kopya, temizlik adayı.
Commit: 50fd06b + 4a8cd82 (masaüstü) + e117473 (telefon)
