# Devir

## 2026-11-12 · her sekme yalın MCP (RAM)
Yapıldı: `mcpProfiliUygula()` eklendi; Şef dışındaki her sekme `ayar.mcpProfil ?? 'yalin'` profiliyle doğuyor, `tam` eski davranışı verir; Şef `sef.json` yoksa ayar profiline düşüyor.
Doğrulama: `node --check main.js` temiz, `npm test` 23/23 yeşil; EVREN yeniden açılmadan canlı gözlem yapılmadı.
Sıradaki: EVREN Desktop bir kez yeniden açılıp yeni sekmelerin MCP çocuk sayısı `oturum-bak durum` ile doğrulanmalı.
Açık: arayüzde profil seçimi yok; yalnız ayar dosyasından (`mcpProfil`) okunuyor.
Commit: bu notla aynı commit

## 2026-11-11 · oturum hijyeni 0.5.0
Yapıldı: oturum açmadan önce bellek kapısı (1.6 GB eşiği, Türkçe hata), orkestratör sekmesi yalın MCP profili (`~/.evren/mcp-profilleri/sef.json` varsa `--strict-mcp-config`), korunan oturumlar dosyası (`~/.evren/korunan-oturumlar.json`) ve `bostaZorlaDk` (240 dk) ile uzun sessiz oturumların kapatılması; çıktılar listesi konsol diline çekildi.
Doğrulama: `npm test` 23/23 yeşil; `node --check main.js` temiz; iki commit push edildi.
Sıradaki: eklenti tarafında `araclar/oturum-bak.mjs` bitince `kapat --eski 12s` kuru koşusunu gerçek oturumlarla bir kez gözle doğrula.
Açık: panelin 8/8 göstergesi ancak ölü oturumlar kapatılınca düşer; canlı gözlem yapılmadı.
Commit: fbc00f3 + 90387d2

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

## 2026-11-10 · Çıktılar (Outputs) bölümü
Yapıldı: sohbet paneline "Çıktılar" sekmesi eklendi. Oturum kaydındaki Write/Edit ve Bash komutlarının ürettiği dosyalar (ekran görüntüleri dahil) artımlı taranıp kart olarak listeleniyor; görsellerde küçük resim, dosya adı, mono yol, durum etiketi, boyut/saat; kartı tıklamak dosyayı açar, klasör düğmesi Explorer'da konumunu gösterir. Tasarım dili styles.css başlığında ve bileşen bloğunda belgelendi (marka adı kullanılmadan).
Doğrulama: `node --check` temiz; `npm test` 16/16 yeşil (yeni test/sohbet-cikti.test.js: 3 test); gerçek oturumlarda 12 ms'de doğru çıktı listesi; ekran kanıtı `_ekran/cikti-gorsel.png`.
Sıradaki: canlı bir oturumda kart tıklama ve "Klasör" eylemini bir kez gözle doğrula.
Commit: 4a8cd82 (paralel oturum ilk sürümü commit+push etti, 06:03); son estetik rafinasyon ve bu not yerelde, kullanıcı GitHub'a eklemeyi istemedi.

## 2026-11-10 · README ekran görüntüleri
Yapıldı: `docs/ekran-ana.png`, `ekran-oturum.png`, `ekran-palet.png` güncel arayüzle yenilendi; görsellerde Wend, Divit, Leucine, Folly Golf, Asterion, Keystone, Halcyon, mizan-panel, evren-desktop, ulak-api işleri görünüyor (demo veri `_demo/demo-veri.js`).
Doğrulama: üç görsel `electron . --ekran ... --ekran-bekle 9000` ile alındı; `npm test` 16/16 yeşil.
Sıradaki: Şef ekran görüntüleri (`ekran-sef-*.png`) hâlâ 9 Kasım arayüzünde; istenirse aynı yöntemle yenilenir.
Açık: `main.js` içindeki `--ekran-bekle` bayrağı ve bu not, paralel oturumun Çıktılar değişiklikleriyle aynı dosyalarda olduğu için yerelde bırakıldı; GitHub'a yalnız docs görselleri ve README alt metinleri gitti.

## 2026-11-10 · Yanıtı durdur + oturum başında efor
Yapıldı: kenar panele "Yanıtı durdur" düğmesi eklendi (Ctrl+C yazar; oturum, sekme ve --resume kimliği yaşar, "Oturumu sonlandır"dan ayrı). Yeni Oturum modalına 03 Efor bölümü geldi (low/medium/high/xhigh/max, claude --effort); seçim ayar.json'daki sonEfor'a yazılıp sonraki oturumun varsayılanı oluyor.
Doğrulama: npm test 19/19 yeşil (test/efor.test.js: 3 test); node --check app.js main.js motor.js temiz; ekran kanıtı _ekran/efor-modal.png (Orta seçili) ve _ekran/durdur-btn.png (iki düğme birlikte).
Sıradaki: canlı DeepSeek oturumunda eforun API'ye geçtiğini ve Ctrl+C'nin kuyrukta bekleyen mesajı geri aldığını bir kez gözle doğrula.
Commit: fa57c95

## 2026-11-11 · Oturum adlandırma
Yapıldı: sekmeye çift tıklama ve geçmiş kartındaki kalem, adlandırma modalını açıyor; ad Claude Code'un `custom-title.json` dosyasına yazılıyor (sekme, geçmiş, Claude Desktop ve telefon aynı adı görür). Boş ad dosyayı silip otomatik ada döndürüyor. Yeni oturumların adı ilk kullanıcı mesajından qwen3.8-flash-next ile 2-6 kelimeye indiriliyor (düşünme kapalı, ~10 token); elle verilen ad AI adını ezer.
Doğrulama: `npm test` 23/23 yeşil (test/oturum-ad.test.js: 4 test); `node --check` app/main/gecmis/preload temiz; ekran kanıtı `_ekran/adlandir-modal.png`.
Sıradaki: canlı oturumda çift tık → ad → telefon listesinde aynı adı bir kez gözle doğrula.
Açık: `app.js`/`styles.css` içindeki eski yerel Çıktılar rafinasyonu yine commit dışında bırakıldı.
