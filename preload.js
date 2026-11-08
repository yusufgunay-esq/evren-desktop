// أَعُوذُ بِاللَّهِ مِنَ الشَّيْطَانِ الرَّجِيمِ
// بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ
/* This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
 * If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
 * Copyright (c) 2026 Yusuf Günay. */
// Renderer ile ana süreç arasındaki dar köprü: yalnız gerekli kanallar.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('evren', {
  durum: () => ipcRenderer.invoke('durum'),
  api: () => ipcRenderer.invoke('api'),
  anahtarKaydet: (deger) => ipcRenderer.invoke('anahtar-kaydet', deger),
  klasorSec: () => ipcRenderer.invoke('klasor-sec'),
  baslat: (secim) => ipcRenderer.invoke('baslat', secim),
  gecmis: (dizin) => ipcRenderer.invoke('gecmis', dizin),
  yaz: (id, veri) => ipcRenderer.invoke('yaz', id, veri),
  boyut: (id, olcu) => ipcRenderer.invoke('boyut', id, olcu),
  kapatOturum: (id) => ipcRenderer.invoke('kapat-oturum', id),
  projeOzet: (dizin) => ipcRenderer.invoke('proje-ozet', dizin),
  disari: (url) => ipcRenderer.invoke('disari', url),
  veriDinle: (f) => ipcRenderer.on('pty:veri', (_e, id, veri) => f(id, veri)),
  cikisDinle: (f) => ipcRenderer.on('pty:cikis', (_e, id, bilgi) => f(id, bilgi)),
  remoteBilgi: () => ipcRenderer.invoke('remote:bilgi'),
  remoteQr: () => ipcRenderer.invoke('remote:qr'),
  remoteYenile: () => ipcRenderer.invoke('remote:yenile'), // yeni token üret, istemcileri kopar
  remoteIpSec: (ip) => ipcRenderer.invoke('remote:ip-sec', ip), // QR'da kullanılacak yerel IP
  remoteDinle: (f) => ipcRenderer.on('remote:durum', (_e, bilgi) => f(bilgi)),
});
