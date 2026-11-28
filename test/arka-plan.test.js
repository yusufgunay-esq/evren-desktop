'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sohbet = require('../sohbet');
const gecmis = require('../gecmis');

const T0 = Date.parse('2026-11-25T01:00:00.000Z');
const zaman = (dk) => new Date(T0 + dk * 60000).toISOString();

function kayitYaz(satirlar) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'arka-'));
  const f = path.join(d, 'x.jsonl');
  fs.writeFileSync(f, satirlar.map((s) => JSON.stringify(s)).join('\n') + '\n');
  return f;
}
const sonuc = (dk, metin) => ({ type: 'user', timestamp: zaman(dk), message: { role: 'user', content: [{ tool_use_id: 't' + dk, type: 'tool_result', content: metin }] } });
const bildirim = (dk, id, durum) => ({ type: 'queue-operation', operation: 'enqueue', timestamp: zaman(dk),
  content: `<task-notification>\n<task-id>${id}</task-id>\n<tool-use-id>t</tool-use-id>\n<status>${durum}</status>\n<summary>x</summary>\n</task-notification>` });
const cevap = (dk, icerik) => ({ type: 'assistant', timestamp: zaman(dk), message: { model: 'glm-5.3', content: icerik } });
const bitti = (dk) => cevap(dk, [{ type: 'text', text: 'İzleyici bekliyor; geldiğinde doğrulayacağım.' }]);

test('arkaPlanBekleyen: bildirimi gelmemiş arka plan komutu oturumu canlı tutar', () => {
  const f = kayitYaz([
    sonuc(0, 'Command running in background with ID: bp3awkbty. Output is being written to: C:\\x.output'),
    bitti(1),
  ]);
  assert.strictEqual(sohbet.oturumDurumu(f), 'bitti', 'tur bitmiş görünür');
  assert.deepStrictEqual(sohbet.arkaPlanBekleyen(f, { simdi: T0 + 90 * 60000 }), { isler: ['bp3awkbty'], uyanma: 0 });
});

test('arkaPlanBekleyen: zaman aşımında arka plana taşınan komut da sayılır', () => {
  const f = kayitYaz([
    sonuc(0, 'Command did not complete within its 120s timeout and was moved to the background (ID: bon7zuy69). Output is being written to: C:\\x.output'),
    bitti(1),
  ]);
  assert.deepStrictEqual(sohbet.arkaPlanBekleyen(f, { simdi: T0 + 30 * 60000 }).isler, ['bon7zuy69']);
});

test('arkaPlanBekleyen: başka bir aracın çıktısında geçen aynı cümle sayılmaz', () => {
  const f = kayitYaz([sonuc(0, 'grep çıktısı: "Command running in background with ID: bp3awkbty."'), bitti(1)]);
  assert.strictEqual(sohbet.arkaPlanBekleyen(f, { simdi: T0 + 30 * 60000 }), null);
});

test('arkaPlanBekleyen: task-notification (completed/failed/killed) işi kapatır', () => {
  for (const durum of ['completed', 'failed', 'killed', 'stopped']) {
    const f = kayitYaz([sonuc(0, 'Command running in background with ID: bp3awkbty.'), bitti(1), bildirim(30, 'bp3awkbty', durum), bitti(31)]);
    assert.strictEqual(sohbet.arkaPlanBekleyen(f, { simdi: T0 + 60 * 60000 }), null, durum);
  }
});

test('arkaPlanBekleyen: Monitor ve Workflow da sayılır; olay bildirimi kapatmaz', () => {
  const f = kayitYaz([
    sonuc(0, 'Monitor started (task bgwlp5qme, expires in 30m unless the source ends first).'),
    sonuc(1, [{ type: 'text', text: 'Workflow launched in background. Task ID: w8w71ddu6\nSummary: x' }]),
    { type: 'queue-operation', timestamp: zaman(5), content: '<task-notification>\n<task-id>bgwlp5qme</task-id>\n<event>frame 1</event>\n</task-notification>' },
    bitti(6),
  ]);
  assert.deepStrictEqual(sohbet.arkaPlanBekleyen(f, { simdi: T0 + 40 * 60000 }).isler.sort(), ['bgwlp5qme', 'w8w71ddu6']);
});

test('arkaPlanBekleyen: tavandan eski, bildirimi hiç gelmeyen iş sayılmaz', () => {
  const f = kayitYaz([sonuc(0, 'Command running in background with ID: bp3awkbty.'), bitti(1)]);
  assert.strictEqual(sohbet.arkaPlanBekleyen(f, { simdi: T0 + 13 * 3600000 }), null);
  assert.ok(sohbet.arkaPlanBekleyen(f, { simdi: T0 + 13 * 3600000, tavanMs: 24 * 3600000 }));
});

test('arkaPlanBekleyen: ScheduleWakeup vakti gelene (+3 dk) kadar bekler, stop iptal eder', () => {
  const f = kayitYaz([cevap(0, [{ type: 'tool_use', id: 'w', name: 'ScheduleWakeup', input: { delaySeconds: 1800, prompt: 'x', reason: 'y' } }]), bitti(1)]);
  assert.strictEqual(sohbet.arkaPlanBekleyen(f, { simdi: T0 + 25 * 60000 }).uyanma, T0 + 30 * 60000);
  assert.ok(sohbet.arkaPlanBekleyen(f, { simdi: T0 + 32 * 60000 }));
  assert.strictEqual(sohbet.arkaPlanBekleyen(f, { simdi: T0 + 34 * 60000 }), null);
  const g = kayitYaz([
    cevap(0, [{ type: 'tool_use', id: 'w', name: 'ScheduleWakeup', input: { delaySeconds: 1800 } }]),
    cevap(2, [{ type: 'tool_use', id: 'w2', name: 'ScheduleWakeup', input: { stop: true } }]),
  ]);
  assert.strictEqual(sohbet.arkaPlanBekleyen(g, { simdi: T0 + 10 * 60000 }), null);
});

test('arkaPlanBekleyen: sıradan tur ve okunamayan dosya null döner', () => {
  assert.strictEqual(sohbet.arkaPlanBekleyen(kayitYaz([bitti(0)]), { simdi: T0 }), null);
  assert.strictEqual(sohbet.arkaPlanBekleyen(path.join(os.tmpdir(), 'yok-' + Date.now() + '.jsonl')), null);
});

test('arkaPlanBekleyen: kısmi çıktı sonrası zaman aşımı ve toolUseResult.backgroundTaskId sayılır', () => {
  const f = kayitYaz([
    sonuc(0, '== 109 ==\n?? 0\n== 091 ==\nCommand did not complete within its 120s timeout and was moved to the background (ID: bdg12leyo). Output is being written to: C:\\x.output'),
    bitti(1),
  ]);
  assert.deepStrictEqual(sohbet.arkaPlanBekleyen(f, { simdi: T0 + 30 * 60000 }).isler, ['bdg12leyo']);
  const g = kayitYaz([
    { type: 'user', timestamp: zaman(0), toolUseResult: { backgroundTaskId: 'bmeta1234', timedOutAfterMs: 120000 }, message: { role: 'user', content: [{ tool_use_id: 't0', type: 'tool_result', content: 'kismi cikti' }] } },
    bitti(1),
  ]);
  assert.deepStrictEqual(sohbet.arkaPlanBekleyen(g, { simdi: T0 + 30 * 60000 }).isler, ['bmeta1234']);
});

test('arkaPlanBekleyen: arka plan alt ajan (async_launched) ve CronCreate oturumu canlı tutar', () => {
  const f = kayitYaz([
    { type: 'user', timestamp: zaman(0), toolUseResult: { status: 'async_launched', agentId: 'ag9812ab' }, message: { role: 'user', content: [{ tool_use_id: 't0', type: 'tool_result', content: 'Async agent launched successfully.\nagentId: ag9812ab' }] } },
    bitti(1),
  ]);
  assert.deepStrictEqual(sohbet.arkaPlanBekleyen(f, { simdi: T0 + 30 * 60000 }).isler, ['ag9812ab']);
  const fBitti = kayitYaz([
    { type: 'user', timestamp: zaman(0), toolUseResult: { status: 'async_launched', agentId: 'ag9812ab' }, message: { role: 'user', content: [{ tool_use_id: 't0', type: 'tool_result', content: 'Async agent launched.' }] } },
    bildirim(10, 'ag9812ab', 'completed'),
    bitti(11),
  ]);
  assert.strictEqual(sohbet.arkaPlanBekleyen(fBitti, { simdi: T0 + 30 * 60000 }), null);
  const c = kayitYaz([
    cevap(0, [{ type: 'tool_use', id: 'c1', name: 'CronCreate', input: { cron: '*/5 * * * *', prompt: 'x' } }]),
    bitti(1),
  ]);
  assert.ok(sohbet.arkaPlanBekleyen(c, { simdi: T0 + 30 * 60000 }).isler.includes('cron'));
  const cSil = kayitYaz([
    cevap(0, [{ type: 'tool_use', id: 'c1', name: 'CronCreate', input: { cron: '*/5 * * * *', prompt: 'x' } }]),
    cevap(5, [{ type: 'tool_use', id: 'c2', name: 'CronDelete', input: { id: 'c1' } }]),
    bitti(6),
  ]);
  assert.strictEqual(sohbet.arkaPlanBekleyen(cSil, { simdi: T0 + 30 * 60000 }), null);
});

test('gecmis.projeCanliEvrenVar: kopuk worktree (ust: null) ve kardeş git worktree worker oturumu korur', () => {
  gecmis.onbellekTemizle();
  const kok = fs.mkdtempSync(path.join(os.tmpdir(), 'evren-wt-'));
  const proje = path.join(kok, 'App');
  const wtIc = path.join(proje, '.claude', 'worktrees', 'dalga-109');
  const wtKardes = path.join(kok, 'app-074');
  const kayitDizini = path.join(kok, 'oturumlar');
  fs.mkdirSync(wtIc, { recursive: true });
  fs.mkdirSync(wtKardes, { recursive: true });
  fs.mkdirSync(kayitDizini, { recursive: true });
  fs.writeFileSync(path.join(wtKardes, '.git'), `gitdir: ${path.join(proje, '.git', 'worktrees', 'app-074').replace(/\\/g, '/')}\n`);

  const id1 = '11111111-1111-4111-8111-111111111111';
  fs.writeFileSync(path.join(kayitDizini, id1 + '.json'), JSON.stringify({
    id: id1, ust: null, pid: process.pid, dizin: wtIc, model: 'glm-5.3', baslik: 'is 109', baslangic: T0, bitis: null,
  }));
  assert.strictEqual(gecmis.projeCanliEvrenVar(proje, { kayitDizini, simdi: T0 + 2 * 3600000 }), true);
  assert.strictEqual(gecmis.projeCanliEvrenVar(kok, { kayitDizini, simdi: T0 + 2 * 3600000 }), false, 'üst klasör yanlış eşlenmez');

  // Bitmiş iş artık korumaz
  fs.writeFileSync(path.join(kayitDizini, id1 + '.json'), JSON.stringify({
    id: id1, ust: null, pid: process.pid, dizin: wtIc, model: 'glm-5.3', baslik: 'is 109', baslangic: T0, bitis: T0 + 60000, cikis: 0,
  }));
  gecmis.onbellekTemizle();
  assert.strictEqual(gecmis.projeCanliEvrenVar(proje, { kayitDizini, simdi: T0 + 2 * 3600000 }), false);

  // Kardeş git worktree (.git dosyası üzerinden) da eşleşir
  const id2 = '22222222-2222-4222-8222-222222222222';
  fs.writeFileSync(path.join(kayitDizini, id2 + '.json'), JSON.stringify({
    id: id2, ust: null, pid: process.pid, dizin: wtKardes, model: 'glm-5.3', baslik: 'is 074', baslangic: T0, bitis: null,
  }));
  gecmis.onbellekTemizle();
  assert.strictEqual(gecmis.projeCanliEvrenVar(proje, { kayitDizini, simdi: T0 + 2 * 3600000 }), true);
});

test('main.js: bostaKontrol arka plan işi, proje worker ve kopuk koşucuyu korur', () => {
  const kaynak = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const blok = kaynak.slice(kaynak.indexOf('const bostaKontrol'), kaynak.indexOf('bostaKontrol.unref'));
  const ix = blok.indexOf('sohbet.arkaPlanBekleyen(');
  assert.ok(ix > 0, 'bostaKontrol arkaPlanBekleyen çağırır');
  assert.ok(ix < blok.indexOf('zorlaAday = '), 'zorla eşiğinden önce');
  assert.ok(blok.includes('bostaArkaPlanSaat'));
  assert.ok(blok.includes('gecmis.projeCanliEvrenVar('), 'proje düzeyinde canlı EVREN işi kontrol edilir');
  assert.ok(blok.includes('projedeAktifKosucuVar('), 'kopuk dalga/worker koşucusu kontrol edilir');

  const mFn = kaynak.match(/const AKTIF_NODE_DESEN[\s\S]*?\r?\n/);
  const mKos = kaynak.match(/function projedeAktifKosucuVar\([\s\S]*?\r?\n\}\r?\n/);
  const projedeAktifKosucuVar = new Function(`${mFn[0]}\n${mKos[0]}; return projedeAktifKosucuVar;`)();
  const eb = new Map([[1, [
    { id: 38104, ad: 'node', komut: 'node "C:\\tools\\sef.mjs" dalga --dizin "C:\\work\\App" 109 110' },
  ]]]);
  assert.strictEqual(projedeAktifKosucuVar(eb, 'C:\\work\\App'), true);
  assert.strictEqual(projedeAktifKosucuVar(eb, 'C:\\work\\App2'), false);
  assert.strictEqual(projedeAktifKosucuVar(eb, 'C:\\work'), false);
});
