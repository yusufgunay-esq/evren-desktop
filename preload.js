// أَعُوذُ بِاللَّهِ مِنَ الشَّيْطَانِ الرَّجِيمِ
// بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ
/* Copyright (c) 2026 Yusuf Günay.
 * This program is free software under the GNU GPL v3 or later; see LICENSE and LICENSE-EK.md. */
// Renderer ile ana süreç arasındaki dar köprü: yalnız gerekli kanallar.
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('evren', {
  durum: () => ipcRenderer.invoke('durum'),
  api: () => ipcRenderer.invoke('api'),
  anahtarKaydet: (deger) => ipcRenderer.invoke('anahtar-kaydet', deger),
  klasorSec: (kaydet) => ipcRenderer.invoke('klasor-sec', kaydet), // proje kaydı oluşturmaz
  projeKaydet: (proje) => ipcRenderer.invoke('proje-kaydet', proje),
  projeSil: (yol) => ipcRenderer.invoke('proje-sil', yol), // yalnız proje listesinden düşürür
  baslat: (secim) => ipcRenderer.invoke('baslat', secim),
  gecmis: (dizin) => ipcRenderer.invoke('gecmis', dizin),
  gecmisAra: (turler, sorgu) => ipcRenderer.invoke('gecmis-ara', turler, sorgu), // sohbet içeriği araması
  tercihOku: () => ipcRenderer.invoke('tercih-oku'), // sabit / arşiv / elle proje / kümeleme (userData JSON)
  tercihYaz: (t) => ipcRenderer.invoke('tercih-yaz', t),
  projeCikar: (liste) => ipcRenderer.invoke('proje-cikar', liste), // klasörsüz oturumun asıl projesi
  gecmisBlok: () => ipcRenderer.invoke('gecmis-blok'), // ölçüm: ana süreçte geçmiş taraması için harcanan süre
  sohbetGecmisi: (id) => ipcRenderer.invoke('sohbet-gecmisi', id),
  oturumBaglam: (id) => ipcRenderer.invoke('oturum-baglam', id), // gerçek bağlam kullanımı + tur sayacı
  yaz: (id, veri) => ipcRenderer.invoke('yaz', id, veri),
  boyut: (id, olcu) => ipcRenderer.invoke('boyut', id, olcu),
  kapatOturum: (id) => ipcRenderer.invoke('kapat-oturum', id),
  oturumKimlik: (id) => ipcRenderer.invoke('oturum-kimlik', id), // şef oturumunun jsonl kimliği
  oturumAdlandir: (bilgi) => ipcRenderer.invoke('oturum-adlandir', bilgi), // custom-title.json yazar
  baslikUret: (metin) => ipcRenderer.invoke('baslik-uret', metin), // ilk mesajdan kısa başlık
  projeOzet: (dizin) => ipcRenderer.invoke('proje-ozet', dizin),
  disari: (url) => ipcRenderer.invoke('disari', url),
  panoOku: () => ipcRenderer.invoke('pano-oku'), // pano metni (ana süreç; Win+V geçmişi dahil)
  panoYaz: (metin) => ipcRenderer.invoke('pano-yaz', metin),
  claudeOturumlari: (deger) => ipcRenderer.invoke('claude-oturumlari', deger), // Claude Code oturumlarını da göster (ayar)
  uykuEngelle: (deger) => ipcRenderer.invoke('uyku-engelle', deger), // çalışan oturum varken uykuyu engelle
  uykuDinle: (f) => ipcRenderer.on('uyku:durum', (_e, acik) => f(acik)), // blok gerçekten devrede mi
  hedefDinle: (f) => ipcRenderer.on('hedef:devam', (_e, id, sayi) => f(id, sayi)), // hedef duraklayınca otomatik devam
  forkDinle: (f) => ipcRenderer.on('oturum:fork', (_e, id, kimlik) => f(id, kimlik)), // --resume yeni kimliğe taşıdı
  veriDinle: (f) => ipcRenderer.on('pty:veri', (_e, id, veri) => f(id, veri)),
  cikisDinle: (f) => ipcRenderer.on('pty:cikis', (_e, id, bilgi) => f(id, bilgi)),
  remoteBilgi: () => ipcRenderer.invoke('remote:bilgi'),
  remoteQr: () => ipcRenderer.invoke('remote:qr'),
  remoteYenile: () => ipcRenderer.invoke('remote:yenile'), // yeni token üret, istemcileri kopar
  remoteIpSec: (ip) => ipcRenderer.invoke('remote:ip-sec', ip), // QR'da kullanılacak yerel IP
  remoteDinle: (f) => ipcRenderer.on('remote:durum', (_e, bilgi) => f(bilgi)),
  modelGuncelle: (id, modelId) => ipcRenderer.invoke('model-guncelle', { id, modelId }),
  oturumCatalla: (bilgi) => ipcRenderer.invoke('oturum-catalla', bilgi),
  sohbetOturumKaydi: (param) => ipcRenderer.invoke('sohbet-oturum-kaydi', param),
  oturumCikti: (param) => ipcRenderer.invoke('oturum-cikti', param), // oturumun ürettiği dosyalar
  panoEkAl: () => ipcRenderer.invoke('pano-ek-al'), // panodaki görsel (yapistir/ altına PNG) ya da kopyalanan dosyalar
  gorselSec: () => ipcRenderer.invoke('gorsel-sec'), // dosya seçici (Görsel ekle)
  dosyaOnizleme: (yol) => ipcRenderer.invoke('dosya-onizleme', yol),
  gorselBuyuk: (yol) => ipcRenderer.invoke('gorsel-buyuk', yol), // önizleme katmanı için büyük görsel
  dosyaYolu: (dosya) => { try { return webUtils.getPathForFile(dosya) || ''; } catch { return ''; } }, // sürükle-bırak
  dosyaAc: (yol) => ipcRenderer.invoke('dosya-ac', yol), // dosyayı varsayılan uygulamada aç
  dosyaKlasor: (yol) => ipcRenderer.invoke('dosya-klasor', yol), // dosya konumunu Explorer'da göster
});
