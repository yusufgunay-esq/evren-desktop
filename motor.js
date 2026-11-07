/* This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
 * If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
 * Copyright (c) 2026 Yusuf Günay. */
// EVREN Desktop motoru: model kataloğu, git dalı, ayarlar ve DPAPI ile şifreli anahtar kasası.
// Ağ isteği yapmaz; yalnız yerel dosya ve Windows DPAPI (PowerShell) kullanır.
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');

// EVREN_VERI_DIZINI: ayar ve kasa klasörünü değiştirir (demo / test için).
const VERI_DIZINI = process.env.EVREN_VERI_DIZINI || path.join(os.homedir(), '.evren-desktop');
const AYAR_DOSYASI = path.join(VERI_DIZINI, 'ayar.json');
const ANAHTAR_DOSYASI = path.join(VERI_DIZINI, 'evren.dpapi');
// Önceki sürümlerin konumları: yalnız okunur (taşıma kolaylığı).
const ESKI_AYAR = path.join(os.homedir(), '.gunay-studio', 'evren-panel.json');
const ESKI_ANAHTAR = path.join(os.homedir(), '.gunay-studio', 'kasa', 'evren.dpapi');

// ---- Model kataloğu ----
// Bilinen modellerin görünen adı ve kısa notu; bağlam ve çıktı sınırı canlı API'den gelir.
const MODEL_BILGISI = {
  'deepseek-v4.1-flash': { ad: 'DeepSeek V4.1 Flash', not: 'rutin kod + uzun iş' },
  'glm-5.3': { ad: 'GLM-5.3', not: 'çetrefilli arayüz / mantık' },
  'qwen3.8-flash-next': { ad: 'Qwen 3.8 Flash Next', not: 'hafif ve hızlı metin' },
  'gemma-4-31b': { ad: 'Gemma 4 31B', not: 'görsel + düşünme' },
  'qwen3-vl-30b': { ad: 'Qwen3 VL 30B', not: 'görsel okuma' },
};
const MODEL_SIRASI = Object.keys(MODEL_BILGISI);

const baglamMetni = (n) => (!n || !Number.isFinite(n) ? '—' : n >= 1048576 ? `${Math.round(n / 1048576)}M bağlam` : `${Math.round(n / 1024)}K bağlam`);

// API'ye ulaşılamazsa gösterilen yedek liste (son doğrulanmış bağlam değerleri).
const MODELLER = [
  ['deepseek-v4.1-flash', 1048576], ['glm-5.3', 524288], ['qwen3.8-flash-next', 262144],
].map(([id, n], i) => ({ no: i + 1, id, ...MODEL_BILGISI[id], baglam: baglamMetni(n), baglamSayisi: n, cikti: null, canli: false }));

// Canlı /v1/models yanıtından sohbet modellerini seçer; bilinenler önce, diğerleri bağlama göre.
function modelleriCoz(veri) {
  const liste = Array.isArray(veri) ? veri : (veri && (veri.data || veri.models)) || [];
  const sohbet = liste.filter((m) => m && typeof m.id === 'string' && (m.task === 'chat' || m.task === 'vision_chat') && m.id !== 'auto');
  const bilinen = MODEL_SIRASI.map((id) => sohbet.find((m) => m.id === id)).filter(Boolean);
  const diger = sohbet.filter((m) => !MODEL_SIRASI.includes(m.id)).sort((a, b) => (b.context_length || 0) - (a.context_length || 0));
  return [...bilinen, ...diger].map((m, i) => ({
    no: i + 1,
    id: m.id,
    ad: (MODEL_BILGISI[m.id] && MODEL_BILGISI[m.id].ad) || m.id,
    not: (MODEL_BILGISI[m.id] && MODEL_BILGISI[m.id].not) || (m.capabilities && m.capabilities.vision ? 'görsel' : 'sohbet'),
    baglam: baglamMetni(m.context_length),
    baglamSayisi: Number.isFinite(m.context_length) ? m.context_length : null,
    cikti: Number.isFinite(m.default_max_output_tokens) ? m.default_max_output_tokens : null,
    canli: true,
  }));
}

// ---- Git dalı (git çalıştırmadan, .git/HEAD okunarak; worktree destekli) ----
function gitDal(dizin) {
  try {
    const yol = path.join(dizin, '.git');
    let head = '';
    if (fs.existsSync(yol) && fs.statSync(yol).isDirectory()) head = fs.readFileSync(path.join(yol, 'HEAD'), 'utf8').trim();
    else if (fs.existsSync(yol)) {
      const isaret = fs.readFileSync(yol, 'utf8').match(/gitdir:\s*(.+)/);
      if (isaret) head = fs.readFileSync(path.join(path.resolve(dizin, isaret[1].trim()), 'HEAD'), 'utf8').trim();
    }
    if (!head) return '';
    const dal = head.match(/ref:\s*refs\/heads\/(.+)/);
    return dal ? dal[1].trim() : head.slice(0, 7);
  } catch { return ''; }
}

// ---- Ayarlar ----
function ayarOku() {
  for (const f of process.env.EVREN_VERI_DIZINI ? [AYAR_DOSYASI] : [AYAR_DOSYASI, ESKI_AYAR]) {
    try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch {}
  }
  return {};
}
function ayarYaz(yeni) {
  const birlesik = { ...ayarOku(), ...yeni };
  try { fs.mkdirSync(VERI_DIZINI, { recursive: true }); fs.writeFileSync(AYAR_DOSYASI, JSON.stringify(birlesik, null, 2)); } catch {}
  return birlesik;
}

// ---- Anahtar kasası: Windows DPAPI (yalnız bu Windows kullanıcısı çözebilir) ----
// Anahtar komut satırına hiç yazılmaz; PowerShell'e stdin ve ortam değişkeniyle geçer.
function powershell(betik, girdi, ortam) {
  return new Promise((coz, red) => {
    const c = execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', betik],
      { encoding: 'utf8', windowsHide: true, timeout: 15000, env: { ...process.env, ...ortam } },
      (h, out) => (h ? red(h) : coz(String(out))));
    if (girdi != null) { c.stdin.write(girdi); }
    c.stdin.end();
  });
}

async function anahtarOku() {
  if (process.platform !== 'win32') return '';
  const oku = '$s = ConvertTo-SecureString (Get-Content -LiteralPath $env:EVREN_KASA -Raw).Trim(); [Console]::Out.Write([Runtime.InteropServices.Marshal]::PtrToStringUni([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)))';
  for (const f of [ANAHTAR_DOSYASI, ESKI_ANAHTAR]) {
    if (!fs.existsSync(f)) continue;
    try { const k = (await powershell(oku, null, { EVREN_KASA: f })).trim(); if (k) return k; } catch {}
  }
  return '';
}

async function anahtarYaz(anahtar) {
  const temiz = String(anahtar || '').replace(/[^\x21-\x7e]/g, '');
  if (!temiz) throw new Error('Boş anahtar.');
  fs.mkdirSync(VERI_DIZINI, { recursive: true });
  const yaz = "$k = [Console]::In.ReadToEnd().Trim(); if (-not $k) { throw 'bos' }; ConvertTo-SecureString $k -AsPlainText -Force | ConvertFrom-SecureString | Set-Content -LiteralPath $env:EVREN_KASA -Encoding ascii";
  await powershell(yaz, temiz, { EVREN_KASA: ANAHTAR_DOSYASI });
  return ANAHTAR_DOSYASI;
}

module.exports = { MODELLER, modelleriCoz, baglamMetni, gitDal, ayarOku, ayarYaz, anahtarOku, anahtarYaz, VERI_DIZINI };
