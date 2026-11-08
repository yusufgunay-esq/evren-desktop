/* This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
 * If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
 * Copyright (c) 2026 Yusuf Günay. */
// Claude Code oturum kayıtları (~/.claude/projects) okuyucu: başlık, kaynak, canlılık ve alt ajanlar.
// Electron'a bağlı değildir; `node -e "require('./gecmis').oturumGecmisi(...)"` ile doğrulanabilir.
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { StringDecoder } = require('node:string_decoder');

const OTURUM_KIMLIK = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CANLI_ESIK_MS = 90 * 1000; // son yazmadan bu yana bu kadar geçmediyse "çalışıyor"
const IS_AKISI_ADI = new Map(); // çalışma betiği yolu -> ad (küçük dosya; mtime değişince yenilenir)

function metinCikar(icerik) {
  if (typeof icerik === 'string') return icerik;
  if (Array.isArray(icerik)) return icerik.map((x) => (x && x.type === 'text' ? x.text : '')).join(' ');
  return '';
}

// İlk gerçek kullanıcı mesajı = oturum başlığı; ilk yanıtın modeli = kaynak (claude-* ise Claude, değilse EVREN).
// Başlık ve model bulununca sonuç önbelleğe alınır, dosya bir daha okunmaz.
const baslikOnbellek = new Map(); // id -> { baslik, kaynak }

function ozelBaslikOku(seansDizin) {
  try {
    const d = path.join(seansDizin, 'custom-title.json');
    const j = JSON.parse(fs.readFileSync(d, 'utf8'));
    return (j && typeof j.customTitle === 'string' && j.customTitle.trim()) || '';
  } catch { return ''; }
}

function baslikOku(dosya) {
  let fd, baslik = '', kaynak = '';
  try {
    fd = fs.openSync(dosya, 'r');
    const tampon = Buffer.alloc(512 * 1024);
    const kod = new StringDecoder('utf8');
    let konum = 0, kalan = '';
    // Açılış kayıtları büyük olabilir (ilk yanıt yüzlerce KB sonra gelir): parça parça oku, en çok 6 MB.
    while (konum < 6 * 1024 * 1024 && !(baslik && kaynak)) {
      const n = fs.readSync(fd, tampon, 0, tampon.length, konum);
      if (n <= 0) break;
      konum += n;
      const satirlar = (kalan + kod.write(tampon.subarray(0, n))).split('\n');
      kalan = satirlar.pop(); // yarım satır bir sonraki parçayla tamamlanır
      for (const satir of satirlar) {
        let j; try { j = JSON.parse(satir); } catch { continue; }
        if (!j || !j.message) continue;
        if (!baslik && j.type === 'user' && !j.isMeta) {
          const m = metinCikar(j.message.content).replace(/<[^>]+>[\s\S]*?<\/[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
          if (m && !m.startsWith('Caveat:') && !m.startsWith('[Request interrupted')) baslik = m.slice(0, 90);
        } else if (!kaynak && j.type === 'assistant' && typeof j.message.model === 'string' && j.message.model !== '<synthetic>') {
          kaynak = /^(claude|opus|sonnet|haiku)/i.test(j.message.model) ? 'claude' : 'evren';
        }
        if (baslik && kaynak) break;
      }
    }
  } catch {} finally { if (fd != null) try { fs.closeSync(fd); } catch {} }
  return { baslik, kaynak };
}

function oturumBilgisi(dosya, id, seansDizin) {
  const c = baslikOnbellek.get(id);
  if (c) return c;
  const ozel = seansDizin ? ozelBaslikOku(seansDizin) : '';
  const b = baslikOku(dosya);
  if (ozel) b.baslik = ozel;
  if (b.baslik && b.kaynak) baslikOnbellek.set(id, b);
  return b;
}

// "Çalışıyor" yalnız kayıt yeni yazılmışsa VE son giriş yanıt beklenen bir giriş ise (kullanıcı mesajı, araç sonucu ya da
// tamamlanmamış asistan yanıtı). Asistan turu bitirdiyse (end_turn) oturum boştadır: sekme açık olsa da çalışmıyordur.
function turDevamEdiyor(dosya, boyut) {
  let fd;
  try {
    fd = fs.openSync(dosya, 'r');
    const uzunluk = Math.min(boyut, 128 * 1024);
    const t = Buffer.alloc(uzunluk);
    fs.readSync(fd, t, 0, uzunluk, boyut - uzunluk);
    const satirlar = t.toString('utf8').split('\n');
    if (boyut > uzunluk) satirlar.shift(); // baştaki yarım satır
    for (let i = satirlar.length - 1; i >= 0; i--) {
      let j; try { j = JSON.parse(satirlar[i]); } catch { continue; }
      if (!j || (j.type !== 'user' && j.type !== 'assistant') || !j.message) continue;
      if (j.type === 'user') return true;
      return !['end_turn', 'stop_sequence', 'max_tokens', 'refusal'].includes(j.message.stop_reason);
    }
  } catch {} finally { if (fd != null) try { fs.closeSync(fd); } catch {} }
  return null; // anlaşılamadı
}

// Workflow ajan klasörünün görünen adı: <oturum>/workflows/wf_x.json içindeki betiğin meta.name alanı.
function isAkisiAdi(seansDizin, klasor) {
  const betik = path.join(seansDizin, 'workflows', klasor + '.json');
  try {
    const s = fs.statSync(betik);
    const c = IS_AKISI_ADI.get(betik);
    if (c && c.ms === s.mtimeMs) return c.ad;
    const j = JSON.parse(fs.readFileSync(betik, 'utf8'));
    const m = typeof j.script === 'string' ? j.script.match(/name\s*:\s*['"]([^'"]+)['"]/) : null;
    const ad = m ? m[1] : '';
    IS_AKISI_ADI.set(betik, { ms: s.mtimeMs, ad });
    return ad;
  } catch { return ''; }
}

// Tek bir alt ajan kaydı: meta.json + agent-<id>.jsonl. Durum meta mtime'ına DEĞİL jsonl'in son yazmasına bakar
// (meta başta bir kez yazılır; mtime'ı tur bitince tazelenmez).
function ajanOku(dizin, metaAd, simdi, ek) {
  const metaYolu = path.join(dizin, metaAd);
  let ms0, j;
  try { ms0 = fs.statSync(metaYolu).mtimeMs; j = JSON.parse(fs.readFileSync(metaYolu, 'utf8')); } catch { return null; }
  if (!j || !j.description) return null;
  const id = metaAd.replace(/\.meta\.json$/, '');
  const jsonlYolu = path.join(dizin, id + '.jsonl');
  let jsonl = null;
  try { jsonl = fs.statSync(jsonlYolu); } catch {}
  const ms = jsonl ? jsonl.mtimeMs : ms0;
  const taze = simdi - ms < CANLI_ESIK_MS;
  const canli = j.finished !== true && !!jsonl && taze && turDevamEdiyor(jsonlYolu, jsonl.size) !== false;
  return {
    id,
    tanim: j.description,
    tur: (j.agentType || '').replace(/^gunay-studio:/, ''),
    model: j.pickedEffortModel || j.model || '',
    faz: j.workflowPhase || '',
    bitti: !canli,
    canli,
    ms,
    ...ek,
  };
}

function metaDosyalariOku(dizin, simdi) {
  let adlar;
  try { adlar = fs.readdirSync(dizin); } catch { return []; }
  const liste = [];
  for (const a of adlar) {
    if (!a.endsWith('.meta.json')) continue;
    const x = ajanOku(dizin, a, simdi, {});
    if (x) liste.push(x);
  }
  return liste;
}

// Alt ajanlar: <oturum>/subagents/agent-*.meta.json (doğrudan ajanlar) ve
// <oturum>/subagents/workflows/wf_*/agent-*.meta.json (iş akışı ajanları; faz bilgisiyle).
function altAjanlariOku(seansDizin) {
  const simdi = Date.now();
  const subDizin = path.join(seansDizin, 'subagents');
  const ajanlar = metaDosyalariOku(subDizin, simdi);

  let klasorler;
  try { klasorler = fs.readdirSync(path.join(subDizin, 'workflows'), { withFileTypes: true }); } catch { klasorler = []; }
  for (const k of klasorler) {
    if (!k.isDirectory() || !k.name.startsWith('wf_')) continue;
    const wfDizin = path.join(subDizin, 'workflows', k.name);
    const ad = isAkisiAdi(seansDizin, k.name);
    for (const a of metaDosyalariOku(wfDizin, simdi)) {
      ajanlar.push({ ...a, isAkisi: k.name, isAkisiAdi: ad });
    }
  }
  return ajanlar.sort((a, b) => a.ms - b.ms);
}

function oturumGecmisi(dizin) {
  if (!dizin || typeof dizin !== 'string') return [];
  const klasor = path.join(os.homedir(), '.claude', 'projects', dizin.replace(/[^a-zA-Z0-9]/g, '-'));
  let adlar;
  try { adlar = fs.readdirSync(klasor); } catch { return []; }
  const simdi = Date.now();
  return adlar
    .filter((a) => a.endsWith('.jsonl') && OTURUM_KIMLIK.test(a.slice(0, -6)))
    .map((a) => { const d = path.join(klasor, a); try { const s = fs.statSync(d); return { id: a.slice(0, -6), dosya: d, ms: s.mtimeMs, boyut: s.size }; } catch { return null; } })
    .filter((x) => x && x.boyut > 0)
    .sort((a, b) => b.ms - a.ms)
    .map((x) => {
      const seansDizin = path.join(klasor, x.id);
      const taze = simdi - x.ms < CANLI_ESIK_MS;
      const turCanli = taze && turDevamEdiyor(x.dosya, x.boyut) !== false;
      const altAjanlar = altAjanlariOku(seansDizin);
      const calisanAjan = altAjanlar.filter((a) => a.canli).length;
      return {
        id: x.id,
        ...oturumBilgisi(x.dosya, x.id, seansDizin),
        ms: x.ms,
        turCanli,
        ajanCalisiyor: calisanAjan > 0,
        calisanAjan,
        canli: turCanli || calisanAjan > 0, // tur bitse de arka planda çalışan alt ajan oturumu "çalışıyor" gösterir
        altAjanlar,
      };
    })
    .filter((x) => x.baslik) // hiç kullanıcı mesajı olmayan (yalnız açılış kaydı) oturumlar listelenmez
    .slice(0, 30);
}

module.exports = { oturumGecmisi, altAjanlariOku, turDevamEdiyor, baslikOku, OTURUM_KIMLIK, CANLI_ESIK_MS };
