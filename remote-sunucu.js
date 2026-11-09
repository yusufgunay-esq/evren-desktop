// أَعُوذُ بِاللَّهِ مِنَ الشَّيْطَانِ الرَّجِيمِ
// بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ
/* This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
 * If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
 * Copyright (c) 2026 Yusuf Günay. */
// EVREN Desktop - Uzaktan Kumanda (Remote Control) Köprüsü
// Yerel ağda WebSocket + HTTP sunucusu açar, QR kod ve mobil eşleşme sağlar.

const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { WebSocketServer, WebSocket } = require('ws');
const QRCode = require('qrcode');
const sohbet = require('./sohbet');

const VARSAYILAN_PORT = 4141;
const TAMPON_LIMIT = 64 * 1024; // Oturum başına son 64 KB terminal çıktısı
const CALISMA_ESIGI_MS = 4 * 1000; // son veri bu kadar yeniyse "çalışıyor"
const KALP_MS = 20 * 1000; // bağlı cihaza ping; pong gelmezse soket ölü sayılır
const PORT_DENEME = 20; // port doluysa sırayla denenecek komşu port sayısı

// ANSI kaçışları ve \r temizlenir; son boş olmayan satır 160 karaktere kısaltılır.
function satirTemizle(veri) {
  if (typeof veri !== 'string' || !veri) return '';
  const duz = veri
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b[@-_]/g, '');
  let son = '';
  for (const parca of duz.split(/[\r\n]+/)) {
    const temiz = parca.trim();
    if (temiz) son = temiz;
  }
  return son.slice(0, 160);
}
const KUMANDA_ADI = 'kumanda.json'; // token, port ve seçili IP burada kalıcı tutulur
const SANAL_DESEN = /vethernet|virtualbox|virtual box|vmware|hyper-?v|wsl|bluetooth|loopback|docker|zerotier|tailscale|hamachi|npcap|openvpn|wireguard|tap-|tun\d/i;

// Electron safeStorage yalnız Electron içinde vardır; düz Node testinde yok sayılır.
function safeStorageAl() {
  try {
    const { safeStorage } = require('electron');
    return safeStorage && typeof safeStorage.isEncryptionAvailable === 'function' ? safeStorage : null;
  } catch { return null; }
}

class RemoteSunucu {
  constructor(opsiyonlar = {}) {
    this.veriDizini = opsiyonlar.veriDizini || null;
    this.kumandaDosyasi = this.veriDizini ? path.join(this.veriDizini, KUMANDA_ADI) : null;
    const kayit = this.kumandaOku();
    // Token her açılışta değişmez: telefondaki kayıtlı bağlantı kırılmasın.
    this.token = kayit.token || crypto.randomBytes(16).toString('hex');
    // Kimlik de sabittir: telefon port/IP değişse bile aynı masaüstünü tanır.
    this.kimlik = kayit.kimlik || crypto.randomUUID();
    this.port = opsiyonlar.port || kayit.port || VARSAYILAN_PORT;
    this.seciliIp = kayit.ip || '';
    this.kalpZamanlayici = null;
    this.kalpMs = Number(opsiyonlar.kalpMs) > 0 ? Number(opsiyonlar.kalpMs) : KALP_MS;
    this.httpServer = null;
    this.wss = null;
    this.istemciler = new Set();
    this.oturumTamponlari = new Map(); // id -> string
    this.aktifOturumId = null;
    this.sonSatirlar = new Map();        // id -> okunabilir son çıktı satırı
    this.sonVeriZamani = new Map();      // id -> son pty verisi zamanı
    this.bekleyenOnaylar = new Map();    // id -> { baslik, soru, metin, secenekler } (bağlantıdan bağımsız)
    this.kapaliOturumlar = new Set();    // id -> kapandı
    this.sohbetAboneleri = new Map();    // oturum id -> Set<ws>
    this.sohbetIzleyiciler = new Map();  // oturum id -> izleyici kaydı
    this.claudeKoku = opsiyonlar.claudeKoku || null; // test: ~/.claude/projects yerine

    // Masaüstü geri çağrımları (callbacks)
    this.onPtyYaz = opsiyonlar.onPtyYaz || (() => {});
    this.onYeniOturum = opsiyonlar.onYeniOturum || (() => {});
    this.onOturumKapat = opsiyonlar.onOturumKapat || (() => {});
    this.onDurumDegisti = opsiyonlar.onDurumDegisti || (() => {});
    this.oturumListesiAl = opsiyonlar.oturumListesiAl || (() => []);
    this.uygulamaDurumuAl = opsiyonlar.uygulamaDurumuAl || (() => ({}));
    this.modellerAl = opsiyonlar.modellerAl || (() => []);
    this.projelerAl = opsiyonlar.projelerAl || (() => []);
    this.oturumBilgisiAl = opsiyonlar.oturumBilgisiAl || (() => ({}));
    this.oturumSayilariAl = opsiyonlar.oturumSayilariAl || (() => null);
  }

  // Telefonun erişebileceği gerçek ağ adresleri: sanal adaptörler (Hyper-V, VirtualBox, VMware, WSL,
  // Bluetooth vb.) elenir; Wi-Fi ve Ethernet öne alınır. Hiç aday kalmazsa tümü döner.
  yerelIpleriBul() {
    const tumu = [];
    const interfaces = os.networkInterfaces();
    for (const ad of Object.keys(interfaces)) {
      const sanalAd = SANAL_DESEN.test(ad);
      for (const ag of interfaces[ad] || []) {
        if (ag.family !== 'IPv4' || ag.internal) continue;
        if (SANAL_DESEN.test(ag.address)) continue;
        if (ag.address.startsWith('192.168.56.')) continue; // VirtualBox host-only varsayılan aralığı
        const kablosuz = /wi-?fi|wlan|wireless|kablosuz/i.test(ad);
        const kablo = /ethernet|^eth\d|^lan/i.test(ad);
        tumu.push({
          ad,
          ip: ag.address,
          sanal: sanalAd,
          oncelik: sanalAd ? 0 : kablosuz ? 3 : kablo ? 2 : /^192\.168\.|^10\./.test(ag.address) ? 1 : 0
        });
      }
    }
    const gercek = tumu.filter((x) => !x.sanal);
    const liste = (gercek.length ? gercek : tumu).sort((a, b) => b.oncelik - a.oncelik);
    if (!liste.length) liste.push({ ad: 'Yerel', ip: '127.0.0.1', sanal: false, oncelik: 0 });
    return liste;
  }

  birincilIp() {
    const ipler = this.yerelIpleriBul();
    // Kullanıcının seçtiği IP hâlâ geçerliyse o kullanılır (telefondaki kayıt bozulmasın).
    if (this.seciliIp && ipler.some((x) => x.ip === this.seciliIp)) return this.seciliIp;
    return ipler[0] ? ipler[0].ip : '127.0.0.1';
  }

  // kumanda.json oku: token (safeStorage şifreli olabilir), port, seçili IP.
  kumandaOku() {
    if (!this.kumandaDosyasi) return {};
    try {
      const j = JSON.parse(fs.readFileSync(this.kumandaDosyasi, 'utf8'));
      let token = '';
      if (typeof j.token === 'string' && /^[0-9a-f]{16,128}$/i.test(j.token)) token = j.token;
      else if (typeof j.tokenSifreli === 'string' && j.tokenSifreli) {
        const ss = safeStorageAl();
        if (ss && ss.isEncryptionAvailable()) {
          try { token = ss.decryptString(Buffer.from(j.tokenSifreli, 'base64')); } catch { token = ''; }
        }
      }
      const port = Number(j.port);
      return {
        token,
        kimlik: typeof j.kimlik === 'string' && /^[0-9a-f-]{16,64}$/i.test(j.kimlik) ? j.kimlik : '',
        port: Number.isInteger(port) && port > 0 && port < 65536 ? port : 0,
        ip: typeof j.ip === 'string' ? j.ip : ''
      };
    } catch { return {}; }
  }

  // kumanda.json yaz; hata sessizce yutulur (kumanda çalışmaya devam eder).
  kumandaYaz() {
    if (!this.kumandaDosyasi) return;
    const veri = { kimlik: this.kimlik, port: this.port, ip: this.seciliIp || '' };
    const ss = safeStorageAl();
    if (ss && ss.isEncryptionAvailable()) {
      try { veri.tokenSifreli = ss.encryptString(this.token).toString('base64'); } catch { veri.token = this.token; }
    } else {
      veri.token = this.token;
    }
    try {
      fs.mkdirSync(path.dirname(this.kumandaDosyasi), { recursive: true });
      fs.writeFileSync(this.kumandaDosyasi, JSON.stringify(veri, null, 2), 'utf8');
    } catch {}
  }

  // Yeni token üret, kaydet, bağlı istemcileri kopar (eski bağlantılar geçersiz olur).
  async tokenYenile() {
    this.token = crypto.randomBytes(16).toString('hex');
    this.kumandaYaz();
    for (const ws of this.istemciler) { try { ws.close(4002, 'Bağlantı yenilendi'); } catch {} }
    this.istemciler.clear();
    this.onDurumDegisti(this.bilgi());
    return this.bilgi();
  }

  // QR için IP seçimi: yalnız gerçek adaylardan biri kabul edilir.
  ipSec(ip) {
    const aday = this.yerelIpleriBul().find((x) => x.ip === ip);
    if (aday) { this.seciliIp = aday.ip; this.kumandaYaz(); this.onDurumDegisti(this.bilgi()); }
    return this.bilgi();
  }

  baglantiUrl() {
    const ip = this.birincilIp();
    return `http://${ip}:${this.port}/?token=${this.token}`;
  }

  async qrKodSvg() {
    const url = this.baglantiUrl();
    try {
      return await QRCode.toString(url, {
        type: 'svg',
        margin: 1,
        color: { dark: '#f0f3f6', light: '#00000000' }
      });
    } catch (e) {
      return '';
    }
  }

  async qrKodPngDataUrl() {
    const url = this.baglantiUrl();
    try {
      return await QRCode.toDataURL(url, {
        margin: 2,
        width: 320,
        color: { dark: '#07090b', light: '#ffffff' }
      });
    } catch (e) {
      return '';
    }
  }

  bilgi() {
    return {
      acik: !!this.httpServer,
      kimlik: this.kimlik,
      port: this.port,
      token: this.token,
      ip: this.birincilIp(),
      seciliIp: this.birincilIp(),
      ipler: this.yerelIpleriBul(),
      url: this.baglantiUrl(),
      bagliCihazSayisi: this.istemciler.size,
      aktifOturumId: this.aktifOturumId
    };
  }

  async baslat(deneme = 0) {
    if (this.httpServer) return this.bilgi();

    return new Promise((resolve, reject) => {
      const sunucu = http.createServer((req, res) => this.httpIstegiKarsila(req, res));
      this.httpServer = sunucu;

      sunucu.on('error', (err) => {
        if (err.code === 'EADDRINUSE' && deneme < PORT_DENEME) {
          // Port doluysa sıradakini dene; port telefondaki QR ile aynı kalmalı diye loglanır.
          this.httpServer = null;
          try { sunucu.close(); } catch {}
          this.port = this.port >= 65535 ? VARSAYILAN_PORT : this.port + 1;
          console.warn(`[remote] port dolu, sıradaki deneniyor: ${this.port}`);
          this.baslat(deneme + 1).then(resolve).catch(reject);
        } else if (err.code === 'EADDRINUSE') {
          reject(new Error(`${PORT_DENEME} port denendi, hepsi dolu (son: ${this.port})`));
        } else {
          reject(err);
        }
      });

      sunucu.listen(this.port, '0.0.0.0', () => {
        const gercekPort = sunucu.address() && sunucu.address().port;
        if (gercekPort) this.port = gercekPort; // 0 verilmişse işletim sisteminin seçtiği port
        this.wss = new WebSocketServer({ server: sunucu });
        this.wss.on('connection', (ws, req) => this.wsBaglantiKarsila(ws, req));
        this.kalpAtisiniBaslat();
        this.kumandaYaz(); // çalışan portu kalıcılaştır
        this.adbTersYonlendir(); // USB kablo ile bağlı Android cihaz varsa portu otomatik eşle
        resolve(this.bilgi());
      });
    });
  }

  // Ölü istemcileri ayıklar: ping'e pong gelmezse soket kapatılır.
  // Aksi hâlde mobil ağ koptuğunda masaüstü ölü bağlantıları "bağlı" saymaya devam eder.
  kalpAtisiniBaslat() {
    if (this.kalpZamanlayici) return;
    this.kalpZamanlayici = setInterval(() => {
      let temizlendi = false;
      for (const ws of this.istemciler) {
        if (ws.isAlive === false) {
          try { ws.terminate(); } catch {}
          this.istemciler.delete(ws);
          this.sohbetAbonelikBirak(ws);
          temizlendi = true;
          continue;
        }
        ws.isAlive = false;
        try { ws.ping(); } catch {}
      }
      if (temizlendi) this.onDurumDegisti(this.bilgi());
    }, this.kalpMs);
    if (this.kalpZamanlayici.unref) this.kalpZamanlayici.unref();
  }

  adbTersYonlendir() {
    try {
      const { execFile } = require('node:child_process');
      execFile('adb', ['reverse', `tcp:${this.port}`, `tcp:${this.port}`], () => {});
    } catch {}
  }

  durdur() {
    if (this.kalpZamanlayici) { clearInterval(this.kalpZamanlayici); this.kalpZamanlayici = null; }
    for (const id of [...this.sohbetIzleyiciler.keys()]) this.sohbetIzlemeyiDurdur(id);
    for (const ws of this.istemciler) {
      try { ws.terminate(); } catch {}
    }
    this.istemciler.clear();
    if (this.wss) {
      try { this.wss.close(); } catch {}
      this.wss = null;
    }
    if (this.httpServer) {
      try { this.httpServer.close(); } catch {}
      this.httpServer = null;
    }
  }

  httpIstegiKarsila(req, res) {
    const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = urlObj.pathname;
    const reqToken = urlObj.searchParams.get('token') || req.headers['x-remote-token'];

    // CORS başlıkları (mobil uygulama ve tarayıcı erişimi için)
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Remote-Token');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (pathname === '/api/durum') {
      if (reqToken !== this.token) {
        res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, hata: 'Yetkisiz erişim.' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        ok: true,
        bilgi: this.bilgi(),
        oturumlar: this.oturumListesiHazirla(),
        durum: this.uygulamaDurumuAl()
      }));
      return;
    }

    if (pathname === '/api/qr') {
      this.qrKodPngDataUrl().then((dataUrl) => {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true, dataUrl, url: this.baglantiUrl() }));
      }).catch(() => {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false }));
      });
      return;
    }

    // Mobil web arayüzü dosyalarını servis et (PWA ve tarayıcı için hazır kumanda sayfası).
    // Yol çözüldükten sonra remote-web içinde kalmıyorsa 404 (path traversal koruması).
    const statikDizin = path.resolve(__dirname, 'remote-web');
    let istenen;
    try { istenen = decodeURIComponent(pathname); } catch { istenen = pathname; }
    const dosyaYolu = path.resolve(statikDizin, istenen === '/' ? 'index.html' : istenen.replace(/^\/+/, ''));
    const icerde = dosyaYolu === statikDizin || dosyaYolu.startsWith(statikDizin + path.sep);

    if (icerde && fs.existsSync(dosyaYolu) && fs.statSync(dosyaYolu).isFile()) {
      const uzanti = path.extname(dosyaYolu).toLowerCase();
      const tipler = {
        '.html': 'text/html; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.js': 'application/javascript; charset=utf-8',
        '.json': 'application/json; charset=utf-8',
        '.svg': 'image/svg+xml',
        '.png': 'image/png',
        '.ico': 'image/x-icon'
      };
      res.writeHead(200, { 'Content-Type': tipler[uzanti] || 'application/octet-stream' });
      fs.createReadStream(dosyaYolu).pipe(res);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Bulunamadı');
  }

  wsBaglantiKarsila(ws, req) {
    const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const token = urlObj.searchParams.get('token');

    if (token !== this.token) {
      ws.close(4001, 'Yetkisiz erişim');
      return;
    }

    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    this.istemciler.add(ws);
    this.onDurumDegisti(this.bilgi());

    // İlk durum paketi: oturumlar, model/proje listeleri ve cevaplanmamış onaylar.
    // Kimlik ve port da gider: telefon IP/port değişse bile aynı masaüstünü tanıyıp kaydını düzeltir.
    const ilkPaket = {
      tip: 'baslangic',
      sunucuKimlik: this.kimlik,
      port: this.port,
      aktifId: this.aktifOturumId,
      oturumlar: this.oturumListesiHazirla(),
      tampon: this.aktifOturumId ? (this.oturumTamponlari.get(this.aktifOturumId) || '') : '',
      modeller: this.modellerAl() || [],
      projeler: this.projelerAl() || [],
      onaylar: [...this.bekleyenOnaylar.entries()].map(([id, onay]) => ({
        id,
        baslik: onay.baslik || 'Onay İsteği',
        soru: onay.soru || '',
        metin: onay.metin || '',
        secenekler: onay.secenekler || [],
      })),
    };
    this.wsGonder(ws, ilkPaket);

    ws.on('message', (ham) => {
      try {
        const mesaj = JSON.parse(ham.toString('utf8'));
        this.wsMesajiIsle(ws, mesaj);
      } catch (err) {
        // Hatalı JSON mesajlarını sessizce yut
      }
    });

    ws.on('close', () => {
      this.istemciler.delete(ws);
      this.sohbetAbonelikBirak(ws);
      this.onDurumDegisti(this.bilgi());
    });

    ws.on('error', () => {
      this.istemciler.delete(ws);
      this.sohbetAbonelikBirak(ws);
      this.onDurumDegisti(this.bilgi());
    });
  }

  wsMesajiIsle(ws, mesaj) {
    if (!mesaj || typeof mesaj.tip !== 'string') return;

    switch (mesaj.tip) {
      case 'ping':
        this.wsGonder(ws, { tip: 'pong', zaman: Date.now() });
        break;

      case 'yaz':
        if (mesaj.id && typeof mesaj.veri === 'string') {
          this.onayCevabiTemizle(mesaj.id);
          this.onPtyYaz(mesaj.id, mesaj.veri);
        }
        break;

      case 'onay':
        // Claude Code onay veya seçim isteklerine hızlı yanıt
        if (mesaj.id && mesaj.secim) {
          const tus = mesaj.secim === 'e' || mesaj.secim === 'y' ? 'y\r' :
                      mesaj.secim === 'h' || mesaj.secim === 'n' ? 'n\r' :
                      mesaj.secim === '1' ? '1\r' :
                      mesaj.secim === '2' ? '2\r' : '\r';
          this.onayCevabiTemizle(mesaj.id);
          this.onPtyYaz(mesaj.id, tus);
        }
        break;

      case 'komut':
        if (mesaj.id && typeof mesaj.komut === 'string') {
          this.onayCevabiTemizle(mesaj.id);
          this.onPtyYaz(mesaj.id, mesaj.komut + '\r');
        }
        break;

      case 'durdur':
        if (mesaj.id) {
          this.onayCevabiTemizle(mesaj.id);
          this.onPtyYaz(mesaj.id, '\x03'); // Ctrl+C
        }
        break;

      // Telefon gerçek sohbete abone olur: ilk abonelikte son 50 giriş, sonrası artımlı.
      case 'sohbet_iste':
        if (mesaj.id) this.sohbetAbone(ws, mesaj.id);
        break;

      case 'oturum_sec':
        if (mesaj.id) {
          this.aktifOturumId = mesaj.id;
          this.wsGonder(ws, {
            tip: 'oturum_degisti',
            id: mesaj.id,
            tampon: this.oturumTamponlari.get(mesaj.id) || ''
          });
        }
        break;

      // بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ — telefondan gelen "yeni oturum" isteğini ana sürece iletir ve sonucu istemciye döndürür.
      case 'yeni_oturum':
        if (typeof this.onYeniOturum === 'function') {
          Promise.resolve(this.onYeniOturum(mesaj.parametreler || {})).then((sonuc) => {
            this.wsGonder(ws, { tip: 'yeni_oturum_sonuc', sonuc });
          }).catch((hata) => {
            this.wsGonder(ws, { tip: 'hata', mesaj: hata.message });
          });
        }
        break;

      case 'oturum_kapat':
        if (mesaj.id && typeof this.onOturumKapat === 'function') {
          this.onOturumKapat(mesaj.id);
        }
        break;
    }
  }

  ptyCiktiEkle(id, veri) {
    if (!id || !veri) return;

    // Tamponu güncelle
    let mevcut = this.oturumTamponlari.get(id) || '';
    mevcut += veri;
    if (mevcut.length > TAMPON_LIMIT) {
      mevcut = mevcut.slice(mevcut.length - TAMPON_LIMIT);
    }
    this.oturumTamponlari.set(id, mevcut);

    // Okunabilir son satır (ANSI temizlenmiş) ve etkinlik zamanı.
    const satir = satirTemizle(veri);
    if (satir) this.sonSatirlar.set(id, satir);
    this.sonVeriZamani.set(id, Date.now());

    // Onay bekleyen durumları filtrele ve tespit et
    const onayIstegi = this.onayTespitiYap(veri);
    if (onayIstegi) {
      this.bekleyenOnaylar.set(id, {
        baslik: onayIstegi.baslik,
        soru: onayIstegi.soru,
        metin: onayIstegi.metin,
        secenekler: onayIstegi.secenekler,
      });
    }

    // Bağlı tüm istemcilere yayınla
    const paket = {
      tip: 'pty_veri',
      id,
      veri,
      onayIstegi
    };
    this.tumuneYayinla(paket);
    if (onayIstegi) this.oturumListesiGuncelle();
  }

  onayTespitiYap(veri) {
    if (typeof veri !== 'string') return null;

    // Claude Code veya genel CLI onay kalıpları
    // ANSI kaçış dizilerini temizle
    const temiz = veri.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');

    const kalıplar = [
      { regex: /(?:allow\s+once|always\s+allow|deny)/i, baslik: 'İşlem İzni', soru: 'Araç çalıştırma izni gerekiyor', secenekler: ['Onayla', 'Reddet'] },
      { regex: /\[y\/n\]|\(y\/n\)|\[Y\/n\]|\[y\/N\]/i, baslik: 'Onay İsteği', soru: 'Devam etmek istiyor musunuz?', secenekler: ['Evet', 'Hayır'] },
      { regex: /Do you want to (?:proceed|continue|execute|run)/i, baslik: 'Çalıştırma Onayı', soru: 'Komut çalıştırılsın mı?', secenekler: ['Evet', 'Hayır'] },
      { regex: /Press enter to continue/i, baslik: 'Devam', soru: 'Devam etmek için dokunun', secenekler: ['Devam'] }
    ];

    for (const k of kalıplar) {
      if (k.regex.test(temiz)) {
        return {
          tespit: true,
          baslik: k.baslik,
          soru: k.soru,
          metin: temiz.trim().slice(-140),
          secenekler: k.secenekler
        };
      }
    }
    return null;
  }

  // Kullanıcı onayı başka yoldan da yanıtlamış olabilir; bekleyen onay her cevapta düşer.
  onayCevabiTemizle(id) {
    if (!this.bekleyenOnaylar.has(id)) return;
    this.bekleyenOnaylar.delete(id);
    this.oturumListesiGuncelle();
  }

  // Oturumun anlık durumu: kapandı > onay bekliyor > son 4 sn içinde veri varsa çalışıyor > boşta.
  durumHesapla(id) {
    if (this.kapaliOturumlar.has(id)) return 'kapandi';
    if (this.bekleyenOnaylar.has(id)) return 'onay_bekliyor';
    const son = this.sonVeriZamani.get(id) || 0;
    return Date.now() - son < CALISMA_ESIGI_MS ? 'calisiyor' : 'bosta';
  }

  /** Listeyi masaüstünün verdiği temel alanlar + kumandanın gördüğü canlı durumla birleştirir. */
  oturumListesiHazirla() {
    const temel = this.oturumListesiAl() || [];
    return temel.map((o) => {
      const bilgi = this.oturumBilgisiAl(o.id) || {};
      const onay = this.bekleyenOnaylar.get(o.id) || null;
      const sayilar = this.oturumSayilariAl(bilgi.dizin, bilgi.devam) || {};
      const alt = sayilar.altAjanlar || { calisan: 0, toplam: 0 };
      const evren = sayilar.evrenIsleri || { calisan: 0, toplam: 0 };
      return {
        id: o.id,
        baslik: o.baslik || bilgi.proje || `Oturum #${o.id}`,
        model: bilgi.modelId || o.model || '',
        modelAd: bilgi.modelAd || '',
        dizin: bilgi.dizin || '',
        proje: bilgi.proje || '',
        durum: this.durumHesapla(o.id),
        sonSatir: this.sonSatirlar.get(o.id) || '',
        onay: onay ? { metin: onay.metin || onay.soru || '', secenekler: onay.secenekler || [] } : null,
        devam: bilgi.devam || null,
        altAjanlar: { calisan: alt.calisan || 0, toplam: alt.toplam || 0 },
        evrenIsleri: { calisan: evren.calisan || 0, toplam: evren.toplam || 0 },
      };
    });
  }

  oturumListesiGuncelle() {
    this.tumuneYayinla({
      tip: 'oturum_listesi',
      oturumlar: this.oturumListesiHazirla(),
      aktifId: this.aktifOturumId
    });
  }

  oturumKapandi(id, kod) {
    this.oturumTamponlari.delete(id);
    this.bekleyenOnaylar.delete(id);
    this.kapaliOturumlar.add(id);
    this.sohbetIzlemeyiDurdur(id);
    if (this.aktifOturumId === id) {
      this.aktifOturumId = null;
    }
    this.tumuneYayinla({
      tip: 'oturum_kapandi',
      id,
      kod
    });
    this.oturumListesiGuncelle();
  }

  // ---------- gerçek sohbet: Claude kaydını izle, abone istemcilere yalnız yenileri gönder ----------

  sohbetAbone(ws, id) {
    let kume = this.sohbetAboneleri.get(id);
    if (!kume) { kume = new Set(); this.sohbetAboneleri.set(id, kume); }
    kume.add(ws);

    const izleyici = this.sohbetIzleyicisi(id);
    if (izleyici.girisler) {
      // İlk abonelik zaten okundu: aynı geçmiş hemen gönderilir.
      this.wsGonder(ws, { tip: 'sohbet', id, girisler: izleyici.girisler, ilk: true });
    } else {
      if (!izleyici.bekleyenler) izleyici.bekleyenler = new Set();
      izleyici.bekleyenler.add(ws);
    }
    this.sohbetIzlemeyiBaslat(id);
  }

  sohbetAbonelikBirak(ws) {
    for (const kume of this.sohbetAboneleri.values()) kume.delete(ws);
  }

  sohbetIzleyicisi(id) {
    let iz = this.sohbetIzleyiciler.get(id);
    if (!iz) {
      iz = { girisler: null, bekleyenler: null, okuyucu: new sohbet.ArtimliOkuyucu(), dosya: null, zamanlayici: null, izleyici: null, deneme: 0, basladi: false };
      this.sohbetIzleyiciler.set(id, iz);
    }
    return iz;
  }

  sohbetIzlemeyiBaslat(id) {
    const iz = this.sohbetIzleyicisi(id);
    if (iz.basladi) return;
    iz.basladi = true;
    const bilgi = this.oturumBilgisiAl(id) || {};

    const tara = () => {
      if (this.kapaliOturumlar.has(id)) return;
      if (!iz.dosya) {
        iz.dosya = sohbet.oturumDosyasiBul({
          dizin: bilgi.dizin,
          devam: bilgi.devam,
          baslangicMs: bilgi.baslangic,
          kokDizin: this.claudeKoku,
        });
        if (!iz.dosya) {
          // Kayıt dosyası henüz oluşmadı: kısa aralıklarla yeniden denenir.
          if (iz.deneme++ < 120) iz.zamanlayici = setTimeout(() => { iz.zamanlayici = null; tara(); }, 1000);
          return;
        }
      }
      // İlk okuma: son 50 giriş (dosyanın sonundan geriye).
      if (!iz.girisler) {
        iz.girisler = iz.okuyucu.sifirla(iz.dosya);
        const bekle = iz.bekleyenler || new Set();
        iz.bekleyenler = null;
        for (const ws of bekle) this.wsGonder(ws, { tip: 'sohbet', id, girisler: iz.girisler, ilk: true });
      }
      // Artımlı okuma: dosya büyüdükçe yalnız yeni satırlar.
      const yenileri = () => {
        const yeni = iz.okuyucu.oku(iz.dosya);
        if (yeni.length) {
          iz.girisler = iz.girisler.concat(yeni).slice(-500);
          this.sohbeteYayinla(id, yeni, false);
        }
      };
      try {
        iz.izleyici = fs.watch(iz.dosya, { persistent: false }, () => yenileri());
      } catch { /* fs.watch desteklenmezse aşağıdaki zamanlayıcı yeter */ }
      iz.zamanlayici = setInterval(yenileri, 1500);
      if (iz.zamanlayici.unref) iz.zamanlayici.unref();
    };
    tara();
  }

  sohbeteYayinla(id, girisler, ilk) {
    const kume = this.sohbetAboneleri.get(id);
    if (!kume || !kume.size || !girisler.length) return;
    // İlk paket zaten her istemciye tek tek gönderildi; burada yalnız yeni girişler yayınlanır.
    if (ilk) return;
    for (const ws of kume) this.wsGonder(ws, { tip: 'sohbet', id, girisler });
  }

  sohbetIzlemeyiDurdur(id) {
    const iz = this.sohbetIzleyiciler.get(id);
    if (!iz) return;
    if (iz.zamanlayici) clearInterval(iz.zamanlayici);
    if (iz.izleyici) { try { iz.izleyici.close(); } catch {} }
    this.sohbetIzleyiciler.delete(id);
    this.sohbetAboneleri.delete(id);
  }

  wsGonder(ws, veri) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify(veri));
      } catch {}
    }
  }

  tumuneYayinla(veri) {
    const metin = JSON.stringify(veri);
    for (const ws of this.istemciler) {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(metin);
        } catch {}
      }
    }
  }
}

module.exports = RemoteSunucu;
