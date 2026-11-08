// أَعُوذُ بِاللَّهِ مِنَ الشَّيْطَانِ الرَّجِيمِ
// بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ
/* EVREN Kumanda — İstemci Mantığı */
(() => {
  let ws = null;
  let baglantiZamanlayici = null;
  let aktifOturumId = null;
  let oturumlar = [];
  let kullaniciKaydirdi = false;

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
    // Eğer Capacitor içindeyse veya özel host kayıtlıysa
    const host = localStorage.getItem('evren_remote_host') || loc.host || 'localhost:4141';
    const proto = loc.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${host}/ws?token=${token}`;
  }

  function baglan() {
    if (ws) {
      try { ws.close(); } catch {}
    }

    baglantiGosterge.className = 'baglanti-durum';
    baglantiMetin.textContent = 'Bağlanıyor...';

    const wsUrl = wsAdresiOlustur();
    try {
      ws = new WebSocket(wsUrl);
    } catch (e) {
      yenidenDene();
      return;
    }

    ws.onopen = () => {
      baglantiGosterge.className = 'baglanti-durum bagli';
      baglantiMetin.textContent = 'Bağlandı';
      titresim(30);
    };

    ws.onmessage = (e) => {
      try {
        const paket = JSON.parse(e.data);
        paketiIsle(paket);
      } catch (err) {}
    };

    ws.onclose = (ev) => {
      baglantiGosterge.className = 'baglanti-durum kopuk';
      if (ev.code === 4001) {
        baglantiMetin.textContent = 'Yetkisiz (Token geçersiz)';
      } else {
        baglantiMetin.textContent = 'Bağlantı koptu';
        yenidenDene();
      }
    };

    ws.onerror = () => {
      baglantiGosterge.className = 'baglanti-durum kopuk';
      baglantiMetin.textContent = 'Hata';
    };
  }

  function yenidenDene() {
    clearTimeout(baglantiZamanlayici);
    baglantiZamanlayici = setTimeout(() => {
      baglan();
    }, 2500);
  }

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

  function terminaliGuncelle(metin, temizle = false) {
    if (temizle) {
      terminalMetin.innerHTML = '';
    }
    if (!metin) {
      terminalMetin.appendChild(bosDurum);
      return;
    }
    if (bosDurum.parentNode === terminalMetin) {
      terminalMetin.removeChild(bosDurum);
    }
    terminaleEkle(metin);
  }

  // Basit ve hızlı ANSI renklendirme / temizleme
  function ansiFormatla(ham) {
    return ham
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, ''); // Temiz metin
  }

  function terminaleEkle(veri) {
    if (bosDurum.parentNode === terminalMetin) {
      terminalMetin.removeChild(bosDurum);
    }
    const temiz = ansiFormatla(veri);
    terminalMetin.appendChild(document.createTextNode(temiz));

    // Tampon boyutu çok büyürse baştan temizle
    while (terminalMetin.childNodes.length > 500) {
      terminalMetin.removeChild(terminalMetin.firstChild);
    }

    if (!kullaniciKaydirdi) {
      terminalMetin.scrollTop = terminalMetin.scrollHeight;
    }
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
