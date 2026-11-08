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

const VARSAYILAN_PORT = 4141;
const TAMPON_LIMIT = 64 * 1024; // Oturum başına son 64 KB terminal çıktısı
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
    this.port = opsiyonlar.port || kayit.port || VARSAYILAN_PORT;
    this.seciliIp = kayit.ip || '';
    this.httpServer = null;
    this.wss = null;
    this.istemciler = new Set();
    this.oturumTamponlari = new Map(); // id -> string
    this.aktifOturumId = null;

    // Masaüstü geri çağrımları (callbacks)
    this.onPtyYaz = opsiyonlar.onPtyYaz || (() => {});
    this.onYeniOturum = opsiyonlar.onYeniOturum || (() => {});
    this.onOturumKapat = opsiyonlar.onOturumKapat || (() => {});
    this.onDurumDegisti = opsiyonlar.onDurumDegisti || (() => {});
    this.oturumListesiAl = opsiyonlar.oturumListesiAl || (() => []);
    this.uygulamaDurumuAl = opsiyonlar.uygulamaDurumuAl || (() => ({}));
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
        port: Number.isInteger(port) && port > 0 && port < 65536 ? port : 0,
        ip: typeof j.ip === 'string' ? j.ip : ''
      };
    } catch { return {}; }
  }

  // kumanda.json yaz; hata sessizce yutulur (kumanda çalışmaya devam eder).
  kumandaYaz() {
    if (!this.kumandaDosyasi) return;
    const veri = { port: this.port, ip: this.seciliIp || '' };
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

  async baslat() {
    if (this.httpServer) return this.bilgi();

    return new Promise((resolve, reject) => {
      this.httpServer = http.createServer((req, res) => this.httpIstegiKarsila(req, res));

      this.httpServer.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          // Port doluysa bir sonrakini dene
          this.port++;
          this.httpServer.close();
          this.httpServer = null;
          this.baslat().then(resolve).catch(reject);
        } else {
          reject(err);
        }
      });

      this.httpServer.listen(this.port, '0.0.0.0', () => {
        this.wss = new WebSocketServer({ server: this.httpServer });
        this.wss.on('connection', (ws, req) => this.wsBaglantiKarsila(ws, req));
        this.kumandaYaz(); // çalışan portu kalıcılaştır
        resolve(this.bilgi());
      });
    });
  }

  durdur() {
    for (const ws of this.istemciler) {
      try { ws.close(); } catch {}
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
        oturumlar: this.oturumListesiAl(),
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

    this.istemciler.add(ws);
    this.onDurumDegisti(this.bilgi());

    // İlk durum paketini gönder
    const ilkPaket = {
      tip: 'baslangic',
      aktifId: this.aktifOturumId,
      oturumlar: this.oturumListesiAl(),
      tampon: this.aktifOturumId ? (this.oturumTamponlari.get(this.aktifOturumId) || '') : ''
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
      this.onDurumDegisti(this.bilgi());
    });

    ws.on('error', () => {
      this.istemciler.delete(ws);
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
          this.onPtyYaz(mesaj.id, tus);
        }
        break;

      case 'komut':
        if (mesaj.id && typeof mesaj.komut === 'string') {
          this.onPtyYaz(mesaj.id, mesaj.komut + '\r');
        }
        break;

      case 'durdur':
        if (mesaj.id) {
          this.onPtyYaz(mesaj.id, '\x03'); // Ctrl+C
        }
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

    // Onay bekleyen durumları filtrele ve tespit et
    const onayIstegi = this.onayTespitiYap(veri);

    // Bağlı tüm istemcilere yayınla
    const paket = {
      tip: 'pty_veri',
      id,
      veri,
      onayIstegi
    };
    this.tumuneYayinla(paket);
  }

  onayTespitiYap(veri) {
    if (typeof veri !== 'string') return null;

    // Claude Code veya genel CLI onay kalıpları
    // ANSI kaçış dizilerini temizle
    const temiz = veri.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');

    const kalıplar = [
      { regex: /(?:allow\s+once|always\s+allow|deny)/i, baslik: 'İşlem İzni', soru: 'Araç çalıştırma izni gerekiyor' },
      { regex: /\[y\/n\]|\(y\/n\)|\[Y\/n\]|\[y\/N\]/i, baslik: 'Onay İsteği', soru: 'Devam etmek istiyor musunuz?' },
      { regex: /Do you want to (?:proceed|continue|execute|run)/i, baslik: 'Çalıştırma Onayı', soru: 'Komut çalıştırılsın mı?' },
      { regex: /Press enter to continue/i, baslik: 'Devam', soru: 'Devam etmek için dokunun' }
    ];

    for (const k of kalıplar) {
      if (k.regex.test(temiz)) {
        return {
          tespit: true,
          baslik: k.baslik,
          soru: k.soru,
          metin: temiz.trim().slice(-140)
        };
      }
    }
    return null;
  }

  oturumListesiGuncelle() {
    const oturumlar = this.oturumListesiAl();
    this.tumuneYayinla({
      tip: 'oturum_listesi',
      oturumlar,
      aktifId: this.aktifOturumId
    });
  }

  oturumKapandi(id, kod) {
    this.oturumTamponlari.delete(id);
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
