# EVREN Remote Control (EVREN Kumanda) İlerleme Takibi

## Kabul Kriterleri (Acceptance Criteria)

- [ ] 1. Masaüstü Köprüsü: EVREN Desktop içinde yerleşik WebSocket ve HTTP sunucusunun (`remote-sunucu.js`) kurulması, token korumalı güvenlik katmanı.
- [ ] 2. Oturum ve PTY Senkronizasyonu: Aktif terminallerin çıktılarının anlık yayınlanması, terminal geçmiş tamponu ve mobil üzerinden terminale giriş (`pty:yaz`) gönderimi.
- [ ] 3. Akıllı Onay Tespiti (Smart Approval Prompt): Claude Code onay veya girdi beklediğinde otomatik tespit edip mobile özel onay olayı (`onay_bekliyor`) fırlatması.
- [ ] 4. Masaüstü Arayüzü Entegrasyonu: Başlık çubuğuna "Kumanda" butonu, minimalist modal açılır penceresi, yerel IP ve taranabilir QR kod bileşeni.
- [ ] 5. Mobil Uygulama (EVREN Kumanda): `d:\Projelerim\evren-kumanda` dizininde modern Capacitor Android projesinin oluşturulması.
- [ ] 6. Mobil Arayüz ve Deneyim: Apple standardında minimalist karanlık mod, sekmeler, canlı terminal çıktısı, büyük onay butonları ("Onayla", "Reddet", "Durdur"), sesli komut / prompt giriş çubuğu, dokunsal geri bildirim (Haptics).
- [ ] 7. QR Kod ile Otomatik Eşleşme: Kamera ile masaüstündeki QR kodu okutup sıfır ayarla anında bağlanma.
- [ ] 8. Pixel 9 Pro XL Kurulumu ve Doğrulama: Bağlı olan Pixel 9 Pro XL cihazına APK'nın derlenip `adb` üzerinden başarıyla yüklenmesi ve çalıştığının kanıtlanması.
- [ ] 9. Uçtan Uca Doğrulama: Masaüstü ve telefon arasında canlı bağlantı, komut gönderimi ve durum akışının test edilmesi.
