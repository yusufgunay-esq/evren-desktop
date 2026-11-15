// أَعُوذُ بِاللَّهِ مِنَ الشَّيْطَانِ الرَّجِيمِ
// بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ
/* Copyright (c) 2026 Yusuf Günay.
 * This program is free software under the GNU GPL v3 or later; see LICENSE and LICENSE-EK.md. */
// Klasörsüz (genel EVREN) oturumun asıl projesini, kaydındaki Write/Edit dosya yollarının çoğunluğundan çıkarır.
// Dosya yollarını sohbet.CiktiIzleyici verir (ikinci bir kayıt tarayıcısı yok); sonuç dosya damgasıyla önbelleklenir.
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sohbet = require('./sohbet');

const ORAN = 0.6;
const EN_AZ = 3;

const duzYol = (p) => String(p || '').replace(/[\\]/g, '/');
const norm = (p) => duzYol(p).replace(/[/]+$/, '').toLowerCase();
const altinda = (yol, kok) => yol === kok || yol.startsWith(kok + '/');

// Çalışma kökleri: bilinen projelerin üst klasörleri (ör. D:\Projelerim). Sürücü kökü ve ev klasörü kök sayılmaz.
function calismaKokleri(projeler, ev = os.homedir()) {
  const evN = norm(ev);
  const kokler = new Map();
  for (const p of projeler || []) {
    for (const y of [p && p.yol, ...((p && p.yollar) || [])]) {
      if (!y) continue;
      const ust = path.dirname(String(y));
      const n = norm(ust);
      if (!n || n === norm(y) || /^[a-z]:$/.test(n) || n === '' || n === evN) continue;
      if (!kokler.has(n)) kokler.set(n, ust);
    }
  }
  return [...kokler.values()];
}

// Dosya yolu hangi proje klasörüne ait: önce en uzun eşleşen bilinen proje, yoksa kökün ilk alt klasörü.
function projeKlasoruBul(dosya, projeler, kokler) {
  const f = norm(dosya);
  let enIyi = null;
  for (const p of projeler || []) {
    for (const y of [p.yol, ...(p.yollar || [])]) {
      const n = norm(y);
      if (n && altinda(f, n) && (!enIyi || n.length > enIyi.uzun)) enIyi = { yol: p.yol, ad: p.ad || path.basename(p.yol), uzun: n.length };
    }
  }
  if (enIyi) return { yol: enIyi.yol, ad: enIyi.ad };
  for (const k of kokler || []) {
    const n = norm(k);
    if (!(f.startsWith(n + '/'))) continue;
    const kalan = duzYol(dosya).slice(n.length + 1);
    const ilk = kalan.split('/')[0];
    if (ilk && kalan.includes('/')) return { yol: path.join(k, ilk), ad: ilk };
  }
  return null;
}

// Yazılan dosyaların ≥%60'ı ve ≥3 dosyası tek proje klasöründeyse o proje; yoksa null.
function cogunlukProje(dosyalar, projeler, kokler, { oran = ORAN, enAz = EN_AZ } = {}) {
  const tekil = [...new Set((dosyalar || []).map(norm).filter(Boolean))];
  if (tekil.length < enAz) return null;
  const sayac = new Map();
  for (const d of dosyalar) {
    const k = projeKlasoruBul(d, projeler, kokler);
    if (!k) continue;
    const a = norm(k.yol);
    if (!sayac.has(a)) sayac.set(a, { ...k, adet: new Set() });
    sayac.get(a).adet.add(norm(d));
  }
  let en = null;
  for (const v of sayac.values()) if (!en || v.adet.size > en.adet.size) en = v;
  if (!en || en.adet.size < enAz || en.adet.size / tekil.length < oran) return null;
  return { yol: en.yol, ad: en.ad };
}

const onbellek = new Map(); // oturum dosyası -> { mtimeMs, size, dosyalar }
const bosver = () => new Promise((r) => setImmediate(r));

function yazilanDosyalar(dosya) {
  let st;
  try { st = fs.statSync(dosya); } catch { return []; }
  const k = onbellek.get(dosya);
  if (k && k.mtimeMs === st.mtimeMs && k.size === st.size) return k.dosyalar;
  const iz = new sohbet.CiktiIzleyici();
  try { iz.oku(dosya); } catch {}
  const dosyalar = iz.yazilanYollar();
  if (onbellek.size > 400) onbellek.clear();
  onbellek.set(dosya, { mtimeMs: st.mtimeMs, size: st.size, dosyalar });
  return dosyalar;
}

// oturumlar: [{ id, projeYol }] (yalnız genel/klasörsüz olanlar). Dönüş: { id: { yol, ad } }.
async function cikar(oturumlar, projeler, { varMi = (y) => { try { return fs.statSync(y).isDirectory(); } catch { return false; } } } = {}) {
  const kokler = calismaKokleri(projeler);
  const sonuc = {};
  for (const o of oturumlar || []) {
    if (!o || !o.id || !o.projeYol) continue;
    const dosya = sohbet.oturumDosyasiBul({ dizin: o.projeYol, devam: o.id });
    if (!dosya) continue;
    const p = cogunlukProje(yazilanDosyalar(dosya), projeler, kokler);
    if (p && varMi(p.yol)) sonuc[o.id] = p;
    await bosver();
  }
  return sonuc;
}

module.exports = { ORAN, EN_AZ, calismaKokleri, projeKlasoruBul, cogunlukProje, cikar };
