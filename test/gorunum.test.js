'use strict';
const test = require('node:test');
const assert = require('node:assert');
const G = require('../gorunum.js');

test('görünüm varsayılanı terminal (yazı terminalden gider); kayıtlı seçim oturum başına hatırlanır', () => {
  assert.strictEqual(G.oku({}, 'd:a'), 'terminal', 'sohbet salt okunur; ilk açılış terminale düşer');
  let h = G.yaz({}, 'd:a', 'terminal');
  h = G.yaz(h, 'd:b', 'sohbet');
  assert.strictEqual(G.oku(h, 'd:a'), 'terminal');
  assert.strictEqual(G.oku(h, 'd:b'), 'sohbet');
  assert.strictEqual(G.oku({ x: 'bozuk' }, 'x'), 'terminal', 'geçersiz değer varsayılana düşer');
  assert.strictEqual(G.oku({}, 'd:yeni', 'dosyalar'), 'dosyalar', 'kayıt yoksa verilen varsayılan');
  assert.strictEqual(G.oku({ 'd:yeni': 'sohbet' }, 'd:yeni', 'terminal'), 'sohbet', 'kayıt varsayılanı ezer');
});

test('yaz girdiyi değiştirmez, geçersiz değeri yutar, sınırı aşan eskiyi atar', () => {
  const h0 = Object.freeze({ a: 'terminal' });
  assert.deepStrictEqual(G.yaz(h0, 'b', 'saçma'), { a: 'terminal' });
  let h = {};
  for (let i = 0; i < 305; i++) h = G.yaz(h, 'k' + i, 'terminal');
  assert.strictEqual(Object.keys(h).length, 300);
  assert.ok(!('k0' in h) && 'k304' in h);
});

test('anahtar: devam varsa kalıcı kimlik, yoksa yerel sayı; karşıt görünüm', () => {
  assert.strictEqual(G.anahtar({ id: 3, devam: 'abc' }), 'd:abc');
  assert.strictEqual(G.anahtar({ id: 3 }), 'y:3');
  assert.strictEqual(G.karsiti('sohbet'), 'terminal');
  assert.strictEqual(G.karsiti('terminal'), 'sohbet');
});

test('dipteMi: yukarı kaydırılmışsa false, dipteyse true', () => {
  assert.strictEqual(G.dipteMi(940, 1000, 60), true);
  assert.strictEqual(G.dipteMi(100, 1000, 60), false);
});

test('altIsBul: eşleşen alt işi başlığından bulur', () => {
  const isler = [{ id: '1', baslik: '7-zip kur' }, { id: '2', baslik: 'bohça zip' }];
  assert.strictEqual(G.altIsBul(isler, 'bohça zip').id, '2');
  assert.strictEqual(G.altIsBul(isler, 'yok'), null);
  assert.strictEqual(G.altIsBul(null, 'x'), null);
});

test('okunmamış kararı: yalnız arka planda biten/soru soran ve görülmemiş oturum', () => {
  const g = (o) => ({ id: 'a', sonDurum: 'bitti', ms: 2000, ...o });
  assert.strictEqual(G.okunmamisMi(g(), {}, false, 1000), true, 'bitti, hiç görülmedi');
  assert.strictEqual(G.okunmamisMi(g({ sonDurum: 'soru' }), {}, false, 1000), true, 'soru sordu');
  assert.strictEqual(G.okunmamisMi(g(), {}, true, 1000), false, 'şu an görünüyor');
  assert.strictEqual(G.okunmamisMi(g({ sonDurum: 'calisiyor' }), {}, false, 1000), false, 'bitmemiş');
  assert.strictEqual(G.okunmamisMi(g({ sonDurum: undefined }), {}, false, 1000), false, 'durum yok');
  assert.strictEqual(G.okunmamisMi(g(), { a: 2000 }, false, 1000), false, 'tam o anda görüldü');
  assert.strictEqual(G.okunmamisMi(g(), { a: 1500 }, false, 1000), true, 'görüldükten sonra yeniden bitti');
  assert.strictEqual(G.okunmamisMi(g({ ms: 900 }), {}, false, 1000), false, 'taban öncesi eski oturum okunmuş sayılır');
  assert.strictEqual(G.okunmamisMi(g({ ms: 'x' }), {}, false, 0), false, 'bozuk zaman');
  assert.strictEqual(G.okunmamisMi(null, {}, false, 0), false);
});

test('hızlı geçiş: boş girişte son açılan 8, yetmezse en yeniyle tamamlanır', () => {
  const liste = Array.from({ length: 12 }, (_, i) => ({ id: 'o' + i, baslik: 'Oturum ' + i, ms: 1000 + i }));
  const s = G.hizliGecis(liste, '', ['o3', 'o1', 'yok'], null);
  assert.deepStrictEqual(s.map((g) => g.id), ['o3', 'o1', 'o11', 'o10', 'o9', 'o8', 'o7', 'o6']);
  assert.strictEqual(G.hizliGecis(liste, '', [], null).length, G.HIZLI_SINIR);
  assert.deepStrictEqual(G.hizliGecis(null, '', null), []);
  assert.deepStrictEqual(G.acilanEkle(['a', 'b', 'c'], 'b'), ['b', 'a', 'c']);
  assert.strictEqual(G.acilanEkle(Array.from({ length: 20 }, (_, i) => 'k' + i), 'yeni').length, 20);
});

test('hızlı geçiş: yazınca Türkçe katlama, yazım toleransı ve sıralama (başlık > proje > bulanık)', () => {
  const liste = [
    { id: 'p', baslik: 'Genel not', projeAd: 'BohçaZip', ms: 5 },
    { id: 'b', baslik: 'Bohçazip sıkıştırma hatası', projeAd: 'Diğer', ms: 1 },
    { id: 'f', baslik: 'Bohcazpi denemesi', projeAd: 'Diğer', ms: 9 },
    { id: 'x', baslik: 'Alakasız', projeAd: 'Başka', ms: 99 },
  ];
  const s = G.hizliGecis(liste, 'bohcazip', [], null).map((g) => g.id);
  assert.deepStrictEqual(s, ['b', 'p', 'f'], 'başlık, proje, sonra yazım hatalı eşleşme; eşleşmeyen yok');
  // Aynı sınıfta son açılan, sonra yeni olan önde.
  const e = [{ id: 'a', baslik: 'rapor a', ms: 10 }, { id: 'b', baslik: 'rapor b', ms: 20 }, { id: 'c', baslik: 'rapor c', ms: 30 }];
  assert.deepStrictEqual(G.hizliGecis(e, 'RAPOR', ['a'], null).map((g) => g.id), ['a', 'c', 'b']);
  assert.deepStrictEqual(G.hizliGecis(e, 'ı', [], null), [], 'tek harf eşleşmez');
  assert.deepStrictEqual(G.hizliGecis(liste, 'zzzzz', [], null), []);
  const pf = () => ({ ad: 'Hesap', yol: 'D:\Projelerim\muhasebe' });
  assert.deepStrictEqual(G.hizliGecis(e, 'muhasebe', [], pf).length, 3, 'projeFn ile proje yolunda eşleşir');
});

test('önceki/sonraki oturum: görünür sırada, uçlarda sarar', () => {
  const l = ['a', 'b', 'c'];
  assert.strictEqual(G.komsuSira(l, 'a', 1), 'b');
  assert.strictEqual(G.komsuSira(l, 'c', 1), 'a');
  assert.strictEqual(G.komsuSira(l, 'a', -1), 'c');
  assert.strictEqual(G.komsuSira(l, null, 1), 'a', 'açık oturum yoksa ilk');
  assert.strictEqual(G.komsuSira(l, null, -1), 'c', 'açık oturum yoksa son');
  assert.strictEqual(G.komsuSira([], 'a', 1), null);
});

test('kısayol tablosu: çakışma yok, tuş eşleştirme Ctrl+K / Ctrl+Alt ayrımını bilir', () => {
  const anahtar = G.KISAYOLLAR.map((k) => `${k.ctrl}|${k.alt}|${k.shift}|${k.code}`);
  assert.strictEqual(new Set(anahtar).size, anahtar.length);
  const bul = (o) => (G.kisayolBul({ ctrlKey: true, ...o }) || {}).eylem;
  assert.strictEqual(bul({ code: 'KeyK' }), 'gecis');
  assert.strictEqual(bul({ code: 'KeyK', shiftKey: true }), 'gecis', 'Ctrl+Shift+K: terminal içindeyken hızlı geçiş');
  assert.strictEqual(bul({ code: 'KeyT', shiftKey: true }), 'ana');
  assert.strictEqual(bul({ code: 'KeyT', altKey: true }), 'yenidenAc');
  assert.strictEqual(bul({ code: 'ArrowUp', altKey: true }), 'onceki');
  assert.strictEqual(bul({ code: 'ArrowDown', altKey: true }), 'sonraki');
  assert.strictEqual(bul({ code: 'ArrowDown' }), undefined, 'Alt olmadan ok tuşu uygulamaya ait değil');
  assert.strictEqual(bul({ code: 'Tab' }), 'sekmeGez');
  assert.strictEqual(bul({ code: 'Tab', shiftKey: true }), 'sekmeGez');
  assert.strictEqual(G.kisayolBul({ ctrlKey: false, code: 'KeyK' }), null);
});

test('claude süzgeci: varsayılan gizli, EVREN ve korunan oturumlar her zaman görünür', () => {
  const l = [
    { id: 'c', kaynak: 'claude' },
    { id: 'e', kaynak: 'evren' },
    { id: 'u' },
    { id: 'ce', kaynak: 'claude', evren: true },
    { id: 'ck', kaynak: 'claude' },
  ];
  assert.deepStrictEqual(G.claudeSuz(l, false).map((g) => g.id), ['e', 'u', 'ce'], 'kaynağı bilinmeyen EVREN sayılır');
  assert.deepStrictEqual(G.claudeSuz(l, true).map((g) => g.id), ['c', 'e', 'u', 'ce', 'ck']);
  assert.deepStrictEqual(G.claudeSuz(l, false, (g) => g.id === 'ck').map((g) => g.id), ['e', 'u', 'ce', 'ck'], 'sekmesi açık Claude oturumu kalır');
  assert.deepStrictEqual(G.claudeSuz(null, false), []);
  assert.strictEqual(G.evrenMi({ kaynak: 'claude' }), false);
  assert.strictEqual(G.evrenMi(null), false);
});

test('terminal odaktayken Ctrl+K terminale kalır, Ctrl+Shift+K hızlı geçişi açar', () => {
  const e = (o) => ({ ctrlKey: true, ...o });
  assert.strictEqual(G.kisayolBul(e({ code: 'KeyK' }), G.KISAYOLLAR, true), null, 'kabukta satır sonuna kadar sil');
  assert.strictEqual(G.kisayolBul(e({ code: 'KeyK', shiftKey: true }), G.KISAYOLLAR, true).eylem, 'gecis');
  assert.strictEqual(G.kisayolBul(e({ code: 'KeyK' }), G.KISAYOLLAR, false).eylem, 'gecis');
});

test('kısayol tablosu: Ctrl+1/2/3 görünümler, Ctrl+F yalnız terminalde, Ctrl+Shift+H döner', () => {
  const bul = (o, t) => (G.kisayolBul({ ctrlKey: true, ...o }, G.KISAYOLLAR, t) || {}).eylem;
  assert.strictEqual(bul({ code: 'Digit1' }), 'gorunumSohbet');
  assert.strictEqual(bul({ code: 'Digit2' }), 'gorunumTerminal');
  assert.strictEqual(bul({ code: 'Digit3' }), 'gorunumDosyalar');
  assert.strictEqual(bul({ code: 'KeyH', shiftKey: true }), 'gorunumDon');
  assert.strictEqual(bul({ code: 'KeyF' }, true), 'terminalAra');
  assert.strictEqual(bul({ code: 'KeyF' }, false), undefined, 'terminal dışında Ctrl+F uygulamaya ait değil');
  assert.strictEqual(bul({ code: 'KeyF', shiftKey: true }, true), 'odak', 'Ctrl+Shift+F odak modu kalır');
  for (const k of G.KISAYOLLAR) assert.ok(k.etiket && k.ad, 'her kısayolun adı ve etiketi var (liste buradan beslenir)');
});

test('kisayolBul: metaKomut=false metaKey olayına null döner (Windows akışı değişmez)', () => {
  assert.strictEqual(G.kisayolBul({ metaKey: true, code: 'KeyP', shiftKey: true }), null, 'yalnız Cmd basılı');
  assert.strictEqual(G.kisayolBul({ metaKey: true, ctrlKey: true, code: 'KeyP', shiftKey: true }), null, 'Ctrl+Cmd bile olsa elenir');
  assert.strictEqual(G.kisayolBul({ ctrlKey: false, metaKey: false, code: 'KeyP' }), null, 'komut tuşu yok');
});

test('kisayolBul: metaKomut=true Cmd kısayollarını bulur, Ctrl de çalışır (macOS)', () => {
  const cmd = (o) => (G.kisayolBul({ metaKey: true, ...o }, G.KISAYOLLAR, false, true) || {}).eylem;
  assert.strictEqual(cmd({ code: 'KeyP', shiftKey: true }), 'palet', 'Cmd+Shift+P paleti açar');
  assert.strictEqual(cmd({ code: 'KeyT', shiftKey: true }), 'ana');
  assert.strictEqual(cmd({ code: 'Digit2' }), 'gorunumTerminal', 'Cmd+2 görünüm değiştirir');
  // metaKomut açıkken Ctrl de komut sayılır (Cmd klavyesi olmayan harici klavyeler).
  assert.strictEqual((G.kisayolBul({ ctrlKey: true, code: 'KeyP', shiftKey: true }, G.KISAYOLLAR, false, true) || {}).eylem, 'palet');
  // metaKomut kapalıysa aynı Ctrl olayı zaten eşleşiyordu: iki modda da Ctrl+K (terminal dışı) hızlı geçiştir.
  for (const mk of [false, true]) {
    assert.strictEqual((G.kisayolBul({ ctrlKey: true, code: 'KeyK' }, G.KISAYOLLAR, false, mk) || {}).eylem, 'gecis');
  }
});

test('kisayolBul: Ctrl+Shift+K terminalde metaKomut farkından bağımsız çalışır, Cmd+K terminale kalır', () => {
  for (const mk of [false, true]) {
    assert.strictEqual((G.kisayolBul({ ctrlKey: true, shiftKey: true, code: 'KeyK' }, G.KISAYOLLAR, true, mk) || {}).eylem, 'gecis');
  }
  // terminalDisi korunur: Cmd+K terminal odaktayken uygulamaya ait değildir (kabuğun satır silme tuşuna düşer).
  assert.strictEqual(G.kisayolBul({ metaKey: true, code: 'KeyK' }, G.KISAYOLLAR, true, true), null);
  assert.strictEqual((G.kisayolBul({ metaKey: true, code: 'KeyK' }, G.KISAYOLLAR, false, true) || {}).eylem, 'gecis');
});

test('etiketDarwin: darwin etikette Ctrl → Cmd, darwin=false etiketi aynen korur', () => {
  assert.strictEqual(G.etiketDarwin('Ctrl ⇧ P', true), 'Cmd ⇧ P');
  assert.strictEqual(G.etiketDarwin('Ctrl Alt ↑', true), 'Cmd Alt ↑');
  assert.strictEqual(G.etiketDarwin('Ctrl K', true), 'Cmd K');
  assert.strictEqual(G.etiketDarwin('Ctrl ⇧ P', false), 'Ctrl ⇧ P', 'darwin değilse etiket değişmez');
  assert.strictEqual(G.etiketDarwin('Ctrl ⇧ P'), 'Ctrl ⇧ P', 'varsayılan darwin=false');
  // Tablodaki davranış etiketten bağımsız: ctrl bayrağı kalmalı, yalnız gösterim değişmeli.
  for (const k of G.KISAYOLLAR) assert.ok(k.ctrl === true, 'etiket değişse bile tablo Ctrl tanımını korur');
});

test('görünümler: üç değer geçerli, sırayla döner, kayıt dosyalar değerini de saklar', () => {
  assert.deepStrictEqual(G.GORUNUMLER, ['sohbet', 'terminal', 'dosyalar']);
  assert.strictEqual(G.sonraki('sohbet'), 'terminal');
  assert.strictEqual(G.sonraki('terminal'), 'dosyalar');
  assert.strictEqual(G.sonraki('dosyalar'), 'sohbet');
  assert.strictEqual(G.sonraki('bozuk'), 'terminal');
  assert.strictEqual(G.oku(G.yaz({}, 'd:x', 'dosyalar'), 'd:x'), 'dosyalar');
});

test('dosya türü ve süzgeci: görsel / kod / diğer, sayılar', () => {
  const l = [
    { yol: 'D:\\p\\a.PNG', resim: true }, { yol: 'D:\\p\\b.js' }, { yol: 'D:\\p\\c.zip' },
    { yol: 'D:\\p\\d.md' }, { yol: 'D:\\p\\e.jpg' }, { yol: 'D:\\p\\Makefile' },
  ];
  assert.strictEqual(G.dosyaTuru(l[0]), 'gorsel');
  assert.strictEqual(G.dosyaTuru(l[1]), 'kod');
  assert.strictEqual(G.dosyaTuru(l[2]), 'diger');
  assert.strictEqual(G.dosyaTuru({ yol: 'x.jpg' }), 'gorsel', 'resim bayrağı yoksa uzantıdan');
  assert.deepStrictEqual(G.dosyaSay(l), { hepsi: 6, gorseller: 2, kod: 2, diger: 2 });
  assert.deepStrictEqual(G.dosyaSuz(l, 'gorseller').map((c) => c.yol), ['D:\\p\\a.PNG', 'D:\\p\\e.jpg']);
  assert.strictEqual(G.dosyaSuz(l, 'kod').length, 2);
  assert.strictEqual(G.dosyaSuz(l, 'hepsi').length, 6);
  assert.deepStrictEqual(G.dosyaSuz(null, 'kod'), []);
});

test('dosya gruplama: proje köküne göre klasör, kök dışı ayrı, en yeni grup önde', () => {
  const kok = 'D:\\Projelerim\\uygulama';
  const l = [
    { yol: 'D:\\Projelerim\\uygulama\\src\\ui\\a.js', ms: 50 },
    { yol: 'D:\\Projelerim\\uygulama\\README.md', ms: 90 },
    { yol: 'D:\\Projelerim\\uygulama\\src\\ui\\b.css', ms: 40 },
    { yol: 'C:\\Temp\\x.txt', ms: 10 },
  ];
  assert.strictEqual(G.goreliYol(l[0].yol, kok), 'src/ui/a.js');
  assert.strictEqual(G.goreliYol('d:\\projelerim\\UYGULAMA\\z.js', kok), 'z.js', 'büyük/küçük harf fark etmez');
  assert.strictEqual(G.goreliYol('C:\\Temp\\x.txt', kok), 'C:\\Temp\\x.txt');
  const g = G.dosyaGrupla(l, kok);
  assert.deepStrictEqual(g.map((x) => x.klasor), ['(kök)', 'src/ui', '(proje dışı)']);
  assert.deepStrictEqual(g[1].ogeler.map((c) => c.goreli), ['src/ui/a.js', 'src/ui/b.css']);
  assert.strictEqual(G.dosyaGrupla([{ yol: 'D:\\x\\y.js', ms: 1 }], '')[0].klasor, '(kök)', 'kök bilinmiyorsa tek grup');
});

test('yapıştırma: dosya adı YYYYMMDD-HHMMSS.png, çakışmada sıra eki; yol metni tırnaklı', () => {
  const t = new Date(2026, 10, 13, 9, 5, 7);
  assert.strictEqual(G.yapistirAdi(t), '20261113-090507.png');
  assert.strictEqual(G.yapistirAdi(t, 2), '20261113-090507-2.png');
  assert.strictEqual(G.yolMetni(['C:\\Kullanıcı Adı\\a b.png']), '"C:\\Kullanıcı Adı\\a b.png" ');
  assert.strictEqual(G.yolMetni(['a.png', 'b.png']), '"a.png" "b.png" ');
  assert.strictEqual(G.yolMetni([]), '');
  assert.strictEqual(G.yolMetni(['x"y.png']), '"xy.png" ', 'tırnak yolu bozamaz');
});

test('yapıştırma kararı: panodaki görsel/dosya eki adres metnini ezer, ikisi yoksa null', () => {
  // Dış uygulama "Resmi kopyala": panoda hem PNG hem kaynak adresi var → görsel yazılır.
  assert.deepStrictEqual(G.panoKarar({ yollar: ['C:\\yapistir\\a.png'], onizleme: 'data:image/png;base64,x' }, 'https://site/x.png'),
    { yollar: ['C:\\yapistir\\a.png'], onizleme: 'data:image/png;base64,x' });
  assert.deepStrictEqual(G.panoKarar({ yollar: ['C:\\a.png', 'C:\\b.png'] }, ''), { yollar: ['C:\\a.png', 'C:\\b.png'], onizleme: null }, 'boş onizleme null döner');
  assert.deepStrictEqual(G.panoKarar(null, 'merhaba'), { metin: 'merhaba' }, 'ek yoksa metin');
  assert.strictEqual(G.panoKarar({ yollar: [] }, 'merhaba').metin, 'merhaba', 'boş ek listesi metni ezmez');
  assert.strictEqual(G.panoKarar(null, ''), null, 'pano boş: yapıştırılacak şey yok');
});

test('sohbet gönderme: boş/boşluk mesaj yok demektir, dolu mesaj tek satır + Enter olur', () => {
  assert.strictEqual(G.gonderilecek(''), '');
  assert.strictEqual(G.gonderilecek('   \n\t '), '', 'yalnız boşluk mesaj sayılmaz');
  assert.strictEqual(G.gonderilecek(null), '');
  assert.strictEqual(G.gonderilecek('  merhaba   dünya \n nasılsın '), 'merhaba dünya nasılsın\r');
});

test('terminal tuş şeridi: gerçek tuş dizileri', () => {
  const d = Object.fromEntries(G.TERMINAL_TUSLARI.map((k) => [k.id, k.dizi]));
  assert.strictEqual(d.esc, '\x1b');
  assert.strictEqual(d.shifttab, '\x1b[Z');
  assert.strictEqual(d.ctrlc, '\x03');
  assert.strictEqual(d.yukari, '\x1b[A');
  assert.strictEqual(d.asagi, '\x1b[B');
  assert.strictEqual(d.bolu, '/');
  assert.strictEqual(d.enter, '\r');
  assert.ok(G.TERMINAL_TUSLARI.every((k) => k.etiket && k.ipucu));
});

test('boyut aynıysa PTY\'ye yeniden bildirilmez (SIGWINCH / TUI yeniden çizimi önlenir)', () => {
  assert.strictEqual(G.boyutAyni({ cols: 120, rows: 30 }, { cols: 120, rows: 30 }), true);
  assert.strictEqual(G.boyutAyni({ cols: '120', rows: '30' }, { cols: 120, rows: 30 }), true, 'sayı metni de aynı sayılır');
});

test('boyut farklıysa ya da defter boşsa bildirim gerekir', () => {
  assert.strictEqual(G.boyutAyni({ cols: 120, rows: 30 }, { cols: 121, rows: 30 }), false);
  assert.strictEqual(G.boyutAyni({ cols: 120, rows: 30 }, { cols: 120, rows: 31 }), false);
  assert.strictEqual(G.boyutAyni(null, { cols: 120, rows: 30 }), false, 'ilk bildirim her zaman gider');
  assert.strictEqual(G.boyutAyni({ cols: 120, rows: 30 }, { cols: 0, rows: 30 }), false, 'geçersiz boyut aynı sayılmaz');
});
