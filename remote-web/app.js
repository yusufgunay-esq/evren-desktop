// أَعُوذُ بِاللَّهِ مِنَ الشَّيْطَانِ الرَّجِيمِ
// بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ
/* EVREN Kumanda — İstemci Mantığı */
(() => {
  let ws = null;
  let baglantiZamanlayici = null;
  let kalpZamanlayici = null;
  let sonPong = 0;
  let deneme = 0;
  let aktifOturumId = null;
  let oturumlar = [];
  let kullaniciKaydirdi = false;

  const KALP_MS = 20000;      // sunucuya ping
  const SESSIZ_MS = 45000;    // bu kadar süre pong/veri gelmezse bağlantı ölü sayılır
  const ACILMA_MS = 12000;    // TCP el sıkışması bu sürede bitmezse denemeyi kapat

  // Elemanlar
  const baglantiGosterge = document.getElementById('baglanti-gosterge');
  const baglantiMetin = document.getElementById('baglanti-metin');
  const oturumListesi = document.getElementById('oturum-listesi');
  const terminalMetin = document.getElementById('terminal-metin');
  const bosDurum = document.getElementById('bos-durum');
  const onayAlani = document.getElementById('onay-alani');
  const onaySoru = document.getElementById('onay-soru');
  const onayOnizleme = document.getElementById('onay-onizleme');
  const btnHizliOnay = document.getElementById('btn-hizli-onay');
  const btnHizliRed = document.getElementById('btn-hizli-red');
  const btnOtoKaydir = document.getElementById('btn-oto-kaydir');
  const komutFormu = document.getElementById('komut-formu');
  const komutGirdi = document.getElementById('komut-girdi');

  // Dokunsal geri bildirim (Haptics)
  function titresim(kalip = 25) {
    if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Haptics) {
      window.Capacitor.Plugins.Haptics.impact({ style: 'light' }).catch(() => {});
    } else if (navigator.vibrate) {
      try { navigator.vibrate(kalip); } catch {}
    }
  }

  // Token ve Bağlantı Adresi
  const urlParams = new URLSearchParams(window.location.search);
  let token = urlParams.get('token') || localStorage.getItem('evren_remote_token') || '';
  if (token) {
    localStorage.setItem('evren_remote_token', token);
  }

  function wsAdresiOlustur() {
    const loc = window.location;
    // Sayfa masaüstünden servis edildiyse gerçek adres odur (QR her zaman güncel portu taşır).
    // Kayıtlı host yalnız Capacitor/file kabuğunda, adres yerelden geliyorsa kullanılır.
    const yerelKabuk = !loc.host || loc.hostname === 'localhost' || loc.hostname === '127.0.0.1';
    const kayitli = localStorage.getItem('evren_remote_host') || '';
    const host = yerelKabuk && kayitli ? kayitli : (loc.host || kayitli || 'localhost:4141');
    if (!yerelKabuk && loc.host) localStorage.setItem('evren_remote_host', loc.host);
    const proto = loc.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${host}/ws?token=${token}`;
  }

  function kalpDurdur() {
    if (kalpZamanlayici) { clearInterval(kalpZamanlayici); kalpZamanlayici = null; }
  }

  function kalpBaslat() {
    kalpDurdur();
    sonPong = Date.now();
    kalpZamanlayici = setInterval(() => {
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      if (Date.now() - sonPong > SESSIZ_MS) {
        // Sunucu sessizleşti: soket yarı açık olabilir, kapatıp yeniden bağlan.
        try { ws.close(); } catch {}
        return;
      }
      mesajGonder({ tip: 'ping' });
    }, KALP_MS);
  }

  function baglan() {
    clearTimeout(baglantiZamanlayici);
    kalpDurdur();
    if (ws) {
      ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
      try { ws.close(); } catch {}
    }

    baglantiGosterge.className = 'baglanti-durum';
    baglantiMetin.textContent = deneme > 0 ? 'Yeniden bağlanıyor...' : 'Bağlanıyor...';

    const wsUrl = wsAdresiOlustur();
    try {
      ws = new WebSocket(wsUrl);
    } catch (e) {
      yenidenDene();
      return;
    }
    const bu = ws;

    // El sıkışma takılırsa: "Bağlanıyor..." sonsuza kadar asılı kalmasın.
    const acilmaZamanAsimi = setTimeout(() => {
      if (bu === ws && bu.readyState !== WebSocket.OPEN) {
        try { bu.close(); } catch {}
      }
    }, ACILMA_MS);

    ws.onopen = () => {
      clearTimeout(acilmaZamanAsimi);
      baglantiGosterge.className = 'baglanti-durum bagli';
      baglantiMetin.textContent = 'Bağlandı';
      deneme = 0;
      kalpBaslat();
      titresim(30);
    };

    ws.onmessage = (e) => {
      sonPong = Date.now();
      try {
        const paket = JSON.parse(e.data);
        paketiIsle(paket);
      } catch (err) {}
    };

    ws.onclose = (ev) => {
      clearTimeout(acilmaZamanAsimi);
      kalpDurdur();
      baglantiGosterge.className = 'baglanti-durum kopuk';
      if (ev.code === 4001) {
        baglantiMetin.textContent = 'Yetkisiz (Token geçersiz)';
      } else {
        yenidenDene();
      }
    };

    ws.onerror = () => {
      // onclose genelde ardından gelir; yine de durumu kopuk göster.
      baglantiGosterge.className = 'baglanti-durum kopuk';
    };
  }

  // Üstel geri çekilme + jitter: sunucu kapalıyken saniyede bir denemeyi önler.
  function yenidenDene() {
    clearTimeout(baglantiZamanlayici);
    deneme = Math.min(deneme + 1, 8);
    const taban = Math.min(30000, 1000 * Math.pow(2, deneme - 1));
    const bekle = Math.round(taban * (0.8 + Math.random() * 0.4));
    baglantiGosterge.className = 'baglanti-durum kopuk';
    baglantiMetin.textContent = `Yeniden bağlanıyor... (${Math.ceil(bekle / 1000)} sn)`;
    baglantiZamanlayici = setTimeout(baglan, bekle);
  }

  // Ağ geri geldiğinde veya sekme öne gelince beklemeden dene.
  function hemenDene() {
    deneme = 0;
    clearTimeout(baglantiZamanlayici);
    baglan();
  }
  window.addEventListener('online', hemenDene);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    if (!ws || ws.readyState !== WebSocket.OPEN) hemenDene();
    else mesajGonder({ tip: 'ping' });
  });

  function paketiIsle(paket) {
    switch (paket.tip) {
      case 'baslangic':
        oturumlar = paket.oturumlar || [];
        aktifOturumId = paket.aktifId;
        oturumCubugunuCiz();
        if (paket.tampon) {
          terminaliGuncelle(paket.tampon, true);
        }
        break;

      case 'oturum_listesi':
        oturumlar = paket.oturumlar || [];
        oturumCubugunuCiz();
        break;

      case 'oturum_degisti':
        aktifOturumId = paket.id;
        oturumCubugunuCiz();
        terminaliGuncelle(paket.tampon || '', true);
        break;

      case 'pty_veri':
        if (paket.id === aktifOturumId) {
          terminaleEkle(paket.veri);
        }
        if (paket.onayIstegi) {
          onayIstegiGoster(paket.id, paket.onayIstegi);
        }
        break;

      case 'oturum_kapandi':
        if (aktifOturumId === paket.id) {
          terminaleEkle(`\r\n[Oturum kapandı (kod: ${paket.kod})]\r\n`);
        }
        break;
    }
  }

  function oturumCubugunuCiz() {
    oturumListesi.innerHTML = '';
    if (!oturumlar.length) {
      const bos = document.createElement('div');
      bos.className = 'sekme-oge';
      bos.textContent = 'Açık oturum yok';
      oturumListesi.appendChild(bos);
      return;
    }

    oturumlar.forEach((o) => {
      const sekme = document.createElement('div');
      sekme.className = `sekme-oge ${o.id === aktifOturumId ? 'aktif' : ''}`;
      
      const nokta = document.createElement('span');
      nokta.className = 'sekme-nokta';
      sekme.appendChild(nokta);

      const baslik = document.createElement('span');
      baslik.textContent = o.baslik || `#${o.id}`;
      sekme.appendChild(baslik);

      sekme.addEventListener('click', () => {
        titresim(20);
        oturumSec(o.id);
      });

      oturumListesi.appendChild(sekme);
    });
  }

  function oturumSec(id) {
    if (aktifOturumId === id) return;
    aktifOturumId = id;
    oturumCubugunuCiz();
    mesajGonder({ tip: 'oturum_sec', id });
  }

  let terminalSatirlar = [];

  // Kapsamlı ve temiz ANSI / ConPTY kaçış dizisi temizliği
  function ansiTemizle(ham) {
    if (!ham) return '';
    return ham
      .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '') // OSC başlık vb.
      .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')        // CSI dizileri
      .replace(/\x1b[@-_]/g, '')                         // Fe kaçışları
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');   // Görünmez kontrol karakterleri
  }

  function satirlariYansit() {
    if (bosDurum.parentNode === terminalMetin) {
      terminalMetin.removeChild(bosDurum);
    }
    terminalMetin.textContent = terminalSatirlar.join('\n');
    if (!kullaniciKaydirdi) {
      terminalMetin.scrollTop = terminalMetin.scrollHeight;
    }
  }

  function terminalTamponaEkle(veri) {
    const temiz = ansiTemizle(veri);
    if (!temiz) return;

    // ConPTY \r (satır başı) ve \n (yeni satır) mantığı:
    // Spinner güncellemeleri (\r ile gelenler) son satırın üzerine yazar.
    let i = 0;
    while (i < temiz.length) {
      const cr = temiz.indexOf('\r', i);
      const lf = temiz.indexOf('\n', i);
      let son = -1;
      let tip = '';
      if (cr !== -1 && lf !== -1) {
        if (cr < lf) { son = cr; tip = 'cr'; }
        else { son = lf; tip = 'lf'; }
      } else if (cr !== -1) {
        son = cr; tip = 'cr';
      } else if (lf !== -1) {
        son = lf; tip = 'lf';
      }

      if (son === -1) {
        const parca = temiz.slice(i);
        if (terminalSatirlar.length === 0) terminalSatirlar.push('');
        terminalSatirlar[terminalSatirlar.length - 1] += parca;
        break;
      }

      const parca = temiz.slice(i, son);
      if (terminalSatirlar.length === 0) terminalSatirlar.push('');
      terminalSatirlar[terminalSatirlar.length - 1] += parca;

      if (tip === 'cr') {
        if (son + 1 < temiz.length && temiz[son + 1] === '\n') {
          terminalSatirlar.push('');
          i = son + 2;
        } else {
          terminalSatirlar[terminalSatirlar.length - 1] = '';
          i = son + 1;
        }
      } else {
        terminalSatirlar.push('');
        i = son + 1;
      }
    }

    if (terminalSatirlar.length > 250) {
      terminalSatirlar = terminalSatirlar.slice(-250);
    }
  }

  function terminaliGuncelle(metin, temizle = false) {
    if (temizle) {
      terminalSatirlar = [];
      terminalMetin.textContent = '';
    }
    if (!metin && terminalSatirlar.length === 0) {
      terminalMetin.innerHTML = '';
      terminalMetin.appendChild(bosDurum);
      return;
    }
    terminalTamponaEkle(metin);
    satirlariYansit();
  }

  function terminaleEkle(veri) {
    terminalTamponaEkle(veri);
    satirlariYansit();
  }

  terminalMetin.addEventListener('scroll', () => {
    const alttaMi = terminalMetin.scrollHeight - terminalMetin.scrollTop - terminalMetin.clientHeight < 40;
    kullaniciKaydirdi = !alttaMi;
    btnOtoKaydir.classList.toggle('gizli', alttaMi);
  });

  btnOtoKaydir.addEventListener('click', () => {
    terminalMetin.scrollTop = terminalMetin.scrollHeight;
    kullaniciKaydirdi = false;
    btnOtoKaydir.classList.add('gizli');
  });

  // Onay Kutusu Yönetimi
  function onayIstegiGoster(id, istek) {
    if (id !== aktifOturumId) return;
    titresim([60, 80, 60]);
    onaySoru.textContent = istek.soru || 'Onay gerekiyor';
    onayOnizleme.textContent = istek.metin || '';
    onayAlani.classList.remove('gizli');
  }

  function onayGizle() {
    onayAlani.classList.add('gizli');
  }

  btnHizliOnay.addEventListener('click', () => {
    titresim(35);
    mesajGonder({ tip: 'onay', id: aktifOturumId, secim: 'e' });
    onayGizle();
  });

  btnHizliRed.addEventListener('click', () => {
    titresim(35);
    mesajGonder({ tip: 'onay', id: aktifOturumId, secim: 'h' });
    onayGizle();
  });

  // Hızlı Eylem Düğmeleri
  document.querySelectorAll('.hizli-eylemler .eylem-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      titresim(25);
      if (!aktifOturumId) return;

      const val = btn.dataset.val;
      if (val) {
        mesajGonder({ tip: 'yaz', id: aktifOturumId, veri: val + '\r' });
      } else if (btn.id === 'btn-aksiyon-dur') {
        mesajGonder({ tip: 'durdur', id: aktifOturumId });
      } else if (btn.id === 'btn-aksiyon-enter') {
        mesajGonder({ tip: 'yaz', id: aktifOturumId, veri: '\r' });
      }
    });
  });

  // Komut Gönderme
  komutFormu.addEventListener('submit', (e) => {
    e.preventDefault();
    const girdi = komutGirdi.value.trim();
    if (!girdi || !aktifOturumId) return;

    titresim(30);
    mesajGonder({ tip: 'komut', id: aktifOturumId, komut: girdi });
    komutGirdi.value = '';
    onayGizle();
  });

  function mesajGonder(veri) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(veri));
    }
  }

  // İlk başlatma
  baglan();
})();
