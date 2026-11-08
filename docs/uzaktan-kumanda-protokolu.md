# Uzaktan Kumanda Protokolü

`remote-sunucu.js` telefonla (EVREN Kumanda) WebSocket üzerinden konuşur. Tüm
mesajlar UTF-8 JSON'dur; her pakette `tip` alanı vardır. Terminal çıktısı
standart olarak `\r\n` satır sonuyla gönderilir (ConPTY). Bilinmeyen alanlar ve
tipler yok sayılır; yeni alanlar isteğe bağlıdır (eski istemciler çalışmaya devam eder).

## Sunucudan istemciye

### `baslangic` (her bağlantıda ilk paket)

```json
{
  "tip": "baslangic",
  "aktifId": 3,
  "oturumlar": [ ...oturum_listesi ile aynı... ],
  "tampon": "aktif oturumun son 64 KB terminal çıktısı",
  "modeller": [{ "id": "deepseek-v4.1-flash", "ad": "DeepSeek V4.1 Flash", "baglam": "1M" }],
  "projeler": [{ "ad": "evren-kumanda", "yol": "D:\\Projelerim\\evren-kumanda", "dal": "main" }],
  "onaylar": [{ "id": 2, "baslik": "İşlem İzni", "soru": "…", "metin": "…", "secenekler": ["Onayla", "Reddet"] }]
}
```

`onaylar` bağlantıdan bağımsız tutulan, henüz cevaplanmamış onaylardır; yeniden
bağlanan istemci bildirimi tekrar görür.

### `oturum_listesi`

```json
{
  "tip": "oturum_listesi",
  "aktifId": 3,
  "oturumlar": [{
    "id": 3,
    "baslik": "evren-kumanda · oturum #3",
    "model": "deepseek-v4.1-flash",
    "modelAd": "DeepSeek V4.1 Flash",
    "dizin": "D:\\Projelerim\\evren-kumanda",
    "proje": "evren-kumanda",
    "durum": "calisiyor",
    "sonSatir": "• adım 42 derleme sürüyor…",
    "onay": { "metin": "npm test çalıştırılsın mı?", "secenekler": ["Onayla", "Reddet"] },
    "devam": "0f8fad5b-d9cb-469f-a165-70867728950e",
    "altAjanlar": { "calisan": 1, "toplam": 3 },
    "evrenIsleri": { "calisan": 0, "toplam": 2 }
  }]
}
```

- `durum`: `calisiyor` (son 4 sn içinde çıktı) · `onay_bekliyor` · `bosta` · `kapandi`.
- `onay`: yoksa `null`; `metin` onay metni, `secenekler` düğme etiketleri.
- `devam`: oturumun Claude kayıt kimliği (uuid); yeni oturum sürdürmek için kullanılır.
- `altAjanlar` / `evrenIsleri`: o oturumun alt ajan ve EVREN işi sayıları (çalışan/toplam).
- Eski istemci için `id` + `baslik` korunur; yeni alanlar yoksa istemci kendi türetir.

### Diğer tipler

| tip | alanlar | anlam |
|---|---|---|
| `pty_veri` | `id`, `veri`, `onayIstegi` | terminal çıktısı; `onayIstegi` `{tespit, baslik, soru, metin, secenekler}` ya da `null` |
| `oturum_degisti` | `id`, `tampon` | seçilen oturumun geçmişi |
| `oturum_kapandi` | `id`, `kod` | oturum sona erdi |
| `yeni_oturum_sonuc` | `sonuc: {id, model, modelAd, dizin, proje, devam}` veya `{hata}` | yeni oturum sonucu |
| `hata` | `mesaj` | genel hata |
| `pong` | `zaman` | ping yanıtı |
| `sohbet` | `id`, `girisler`, `ilk?` | gerçek sohbet girişleri (aşağıda) |

### `sohbet`

Oturumun Claude kaydı (`~/.claude/projects/<dizin>/<devam>.jsonl`) izlenir.
İlk abonelikte son 50 giriş (`ilk: true`, istemci listeyi değiştirir), sonra
yalnız yeni girişler (`ilk` yok, istemci ekler) gönderilir. Araç sonuçları ilk
200 karakterlik özetle gelir.

```json
{
  "tip": "sohbet",
  "id": 3,
  "ilk": true,
  "girisler": [
    { "rol": "kullanici", "metin": "merhaba de", "ms": 1762500000000 },
    { "rol": "asistan", "metin": "Merhaba! …", "ms": 1762500001200 },
    { "rol": "arac", "metin": "npm test", "arac": { "ad": "Bash", "ozet": "npm test" }, "ms": 1762500002000 }
  ]
}
```

`rol`: `kullanici` · `asistan` · `arac`. `arac` yalnız araç girişlerinde vardır.

## İstemciden sunucuya

| tip | alanlar | anlam |
|---|---|---|
| `ping` | — | bağlantı canlılığı |
| `yaz` | `id`, `veri` | ham terminal girdisi (`\r`, ESC vb. dahil) |
| `onay` | `id`, `secim` | `e`/`y` → `y\r`, `h`/`n` → `n\r`, `1`/`2`, diğer → `\r` |
| `komut` | `id`, `komut` | komut + `\r` |
| `durdur` | `id` | Ctrl+C |
| `oturum_sec` | `id` | tamponu iste |
| `oturum_kapat` | `id` | PTY'yi sonlandır |
| `sohbet_iste` | `id` | gerçek sohbete abone ol |
| `yeni_oturum` | `parametreler` | aşağıdaki şema |

### `yeni_oturum` parametre şeması

```json
{ "tip": "yeni_oturum",
  "parametreler": {
    "modelId": "deepseek-v4.1-flash",   // zorunlu; model listesinden (baslangic.modeller)
    "dizin": "D:\\Projelerim\\x",        // zorunlu; var olan klasör (baslangic.projeler)
    "cols": 100,                        // isteğe bağlı PTY sütunu (20'den büyük; varsayılan 120)
    "rows": 30,                         // isteğe bağlı PTY satırı (5'ten büyük; varsayılan 30)
    "devam": "0f8fad5b-…"               // isteğe bağlı; önceki oturumu sürdür (uuid)
  }
}
```

Geçersiz `devam` kimliği hata döndürür. Sekiz canlı oturum sınırı vardır.

## Güvenlik

Token uyuşmazlığında sunucu `close(4001, 'Yetkisiz erişim')` yapar; istemci
yeniden denemeyi bırakır. Token yalnız WebSocket sorgusunda (`?token=…`) gider,
günlüğe yazılmaz.
