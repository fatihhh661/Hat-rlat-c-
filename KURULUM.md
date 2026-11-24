# Anımsa — Kurulum Rehberi

Bu rehber, Anımsa'yı **ücretsiz** bir Cloudflare hesabında yayınlayıp iPhone'unuza kurmanızı adım adım anlatır. Bilgisayar bilgisi gerekmez; yaklaşık 15 dakika sürer.

**İhtiyacınız olanlar:**
- Bir bilgisayar (Cloudflare ayarları için; telefondan da yapılabilir ama zor)
- iOS **16.4 veya üstü** bir iPhone (Ayarlar › Genel › Hakkında › iOS Sürümü)
- Bu depodaki **`worker.js`** dosyası (uygulamanın tamamı bu tek dosyanın içinde)

> Cloudflare panelindeki düğme adları zaman zaman değişebilir. Aşağıdaki adımlarda adı biraz farklı bir düğme görürseniz en yakın karşılığını seçin.

---

## 1. Cloudflare hesabı açın

1. Bilgisayarda **https://dash.cloudflare.com/sign-up** adresine gidin.
2. E-posta adresinizi ve bir şifre yazıp **Sign up** (Kaydol) düğmesine basın.
3. E-postanıza gelen doğrulama bağlantısına tıklayın.
4. Alan adı (domain) eklemenizi isterse bu adımı **atlayın**. Alan adına gerek yok.

## 2. Worker oluşturun

1. Sol menüden **Workers & Pages** bölümüne girin. (Menüde yoksa **Compute (Workers)** altında olabilir.)
2. **Create** (Oluştur) düğmesine basın.
3. **Start with Hello World!** (veya "Create Worker") seçeneğini seçin.
4. Ad olarak örneğin **`animsa`** yazın. Adresiniz şuna benzer olacak: `https://animsa.KULLANICIADI.workers.dev`
5. **Deploy** (Yayınla) düğmesine basın. Şimdilik örnek kod yayınlanır, birazdan değiştireceğiz.

## 3. Kodu yapıştırın

1. Açılan sayfada **Edit code** (Kodu düzenle) düğmesine basın.
2. Soldaki dosya listesinde `worker.js` (bazen `index.js`) açık olacak. İçindeki kodun **tamamını silin**: içine tıklayın, `Ctrl+A` (Mac'te `Cmd+A`) ile hepsini seçip `Delete`'e basın.
3. Bu depodaki **`worker.js`** dosyasını bir metin düzenleyiciyle açın, içeriğin **tamamını** kopyalayın (`Ctrl+A`, `Ctrl+C`).
4. Cloudflare düzenleyicisine yapıştırın (`Ctrl+V`). Dosya büyük (yaklaşık 650 KB) olduğu için yapıştırmak birkaç saniye sürebilir.
5. Sağ üstteki **Deploy** düğmesine basın ve onaylayın.

## 4. KV deposunu oluşturup "KV" adıyla bağlayın

Hatırlatıcılar ve bildirim aboneliği burada saklanır.

**4a. Depoyu oluşturun**
1. Sol menüden **Storage & Databases › KV** bölümüne girin (eski panelde: **Workers & Pages › KV**).
2. **Create** (veya "Create a namespace") düğmesine basın.
3. Ad olarak **`animsa-kv`** yazıp **Add** / **Create**'e basın.

**4b. Worker'a bağlayın**
1. **Workers & Pages** bölümüne dönüp **animsa** Worker'ınızı açın.
2. **Settings** (Ayarlar) sekmesine, sonra **Bindings** (Bağlamalar) bölümüne girin.
3. **Add** (Ekle) › **KV namespace** seçin.
4. **Variable name** (Değişken adı) alanına tam olarak **`KV`** yazın (büyük harflerle, başka bir şey değil).
5. **KV namespace** listesinden **animsa-kv**'yi seçin.
6. **Save** / **Deploy** düğmesine basın.

## 5. Her dakika çalışan zamanlayıcıyı ekleyin

Bildirimleri zamanında gönderen kısım budur.

1. Aynı Worker'ın **Settings** sekmesinde **Trigger Events** (eski panelde **Triggers**) bölümüne girin.
2. **Add** › **Cron Triggers** (Zamanlanmış tetikleyici) seçin.
3. **Cron** alanına tam olarak şunu yazın: **`* * * * *`** (beş yıldız, aralarında birer boşluk). Bu "her dakika" demektir.
4. **Add** / **Save** düğmesine basın.

## 5b. Sesli tanımayı açın (Workers AI bağlaması)

Küreye dokunup konuşunca sesin yazıya çevrilmesi için gerekir. iPhone, ana ekran uygulamalarında kendi konuşma tanımasını kullandırmadığı için ses, Cloudflare'in Workers AI hizmetindeki **Whisper** modeliyle yazıya çevrilir. Ayrı bir hesap ya da anahtar gerekmez.

1. Worker'ın **Settings › Bindings** bölümüne girin (KV'yi eklediğiniz yer).
2. **Add** › **Workers AI** seçin.
3. **Variable name** alanına tam olarak **`AI`** yazın.
4. **Save** / **Deploy** düğmesine basın.

Notlar:
- Sesiniz yalnızca yazıya çevrilmek için Cloudflare'e gönderilir; uygulama kaydı saklamaz.
- Workers AI'ın günlük ücretsiz kotası kişisel kullanım için yeterlidir. Kota dolarsa o gün sesli tanıma çalışmaz, klavye mikrofonu her zaman çalışır.
- Bu adımı atlarsanız uygulama çalışır, yalnızca küre sizi klavyedeki 🎤 simgesine yönlendirir.

## 6. Çalıştığını kontrol edin

1. Worker sayfasının üstündeki adrese tıklayın (`https://animsa.KULLANICIADI.workers.dev`).
2. Koyu renkli, parlayan bir küre ve "Söyle, unutma." yazısı görmelisiniz.
3. Adresin sonuna `/api/config` ekleyip açın. Şuna benzer bir yazı görmelisiniz: `{"ok":true,"publicKey":"B...","ai":true}`.
   - Sonda `"ai":false` yazıyorsa 5b adımını kontrol edin (değişken adı tam olarak `AI`).
   - `kv_missing` hatası görürseniz 4b adımını tekrar kontrol edin (değişken adı tam olarak `KV` olmalı).

## 7. iPhone'a kurun

1. iPhone'da **Safari**'yi açın (Chrome değil, mutlaka Safari).
2. Worker adresinizi yazın: `https://animsa.KULLANICIADI.workers.dev`
3. Ekranın altındaki **Paylaş** simgesine dokunun (yukarı ok çıkan kare).
4. Listeyi aşağı kaydırıp **Ana Ekrana Ekle**'ye dokunun.
5. Sağ üstteki **Ekle**'ye dokunun.
6. Safari'yi kapatın. Ana ekranda **Anımsa** simgesi belirecek. **Uygulamayı bu simgeden açın.** (Bildirimler yalnızca ana ekrandan açılınca çalışır.)

## 8. Bildirim iznini verin

1. Anımsa'yı ana ekrandan açın. Tanıtım ekranları gelir.
2. Son ekranda **Bildirimleri aç** düğmesine dokunun.
3. iPhone "Anımsa bildirim göndermek istiyor" diye sorar: **İzin Ver**'e dokunun.
4. Konfeti ve "Hazırsın" yazısı görünce kurulum tamamdır.

Tanıtımı atladıysanız: sağ üstteki ayar düğmesi › **Bildirimleri aç** › **Aç**.

## 9. Test bildirimi gönderin

1. Sağ üstteki ayar düğmesine dokunun.
2. **Test bildirimi** satırındaki **Gönder**'e dokunun.
3. Birkaç saniye içinde "⏰ Hatırlatıcı — Test bildirimi: her şey yolunda! 🎉" bildirimi gelmeli.
4. Asıl deneme: telefonu kilitleyin, önce şunu söyleyin ya da yazın: **"2 dakika sonra test"** → **Hatırlat**. 1–3 dakika içinde kilit ekranına bildirim gelmeli.

---

## Kullanım

- **Yazarak:** Alttaki kutuya "Yarın sabah 9'da toplantı" gibi yazın. Altında "Anladığım: Yarın 09:00 • Toplantı" görünür. Klavyede **Bitti**'ye basın, açılan kartta **Hatırlat**'a dokunun.
- **Klavye mikrofonuyla:** Kutuya dokunun, klavyedeki 🎤 simgesine basıp konuşun.
- **Uygulama mikrofonuyla:** Sağdaki parlayan küreye dokunun, konuşun. Susunca (ya da ✓'ye dokununca) kayıt biter, 1–3 saniye içinde onay kartı açılır. İlk seferde iPhone mikrofon izni ister: **İzin Ver**. Konuşurken yazı canlı akmaz, bitince bir anda gelir.
- **Hızlı çipler:** Önce görevi yazın, sonra "10 dk sonra" gibi bir çipe dokunun.
- **Silme:** Kartı sola kaydırın. Hızlı kaydırırsanız doğrudan silinir. "Sıradaki hatırlatıcı" kartında çöp kutusuna iki kez dokunun.
- **Erteleme:** Bildirime dokunup uygulamayı açınca "10 dk ertele / 1 saat ertele / Tamam" seçenekleri çıkar.

## Bilinen sınırlar (dürüstçe)

- **iOS 16.4+ ve ana ekrandan açma şart.** Safari sekmesinde iPhone web bildirimi göndermez.
- **Dakika hassasiyeti:** Zamanlayıcı dakikada bir çalışır. Bildirim, ayarlanan zamandan **en fazla 1–2 dakika** geç (ya da en çok 15 saniye erken) gelebilir. Cloudflare'in yoğun anlarında birkaç dakikalık gecikme nadiren olabilir.
- **Odak / Rahatsız Etme modu** açıksa bildirim sessiz gelebilir ya da görünmeyebilir. Ayarlar › Odak bölümünden Anımsa'ya izin verebilirsiniz.
- **Bildirim sesi:** iOS, web uygulamalarına özel ses seçtirmez. Ses iPhone'un varsayılan bildirim sesidir. "Sessiz" seçeneğini bazı iOS sürümleri yok sayabilir.
- **Uygulama içi mikrofon** internet ve Workers AI bağlaması gerektirir (5b). Klavye mikrofonu her zaman çalışır.
- **Tekrarlayan hatırlatıcı yok** (tasarım gereği).
- Uygulama açıkken zamanı gelen hatırlatıcı için ekranda da zil çalan bir uyarı çıkar (yedek).

## Sorun giderme: Bildirim gelmiyor

Sırayla kontrol edin:

1. **Uygulamayı ana ekrandaki simgeden mi açtınız?** Safari'den açıldıysa bildirim çalışmaz.
2. **iOS sürümü 16.4 veya üstü mü?** Ayarlar › Genel › Hakkında.
3. **Bildirim izni açık mı?** iPhone Ayarlar › Bildirimler › **Anımsa** › **Bildirimlere İzin Ver** açık olmalı, "Kilit Ekranı" ve "Afişler" işaretli olmalı.
4. **Uygulamada rozet "Açık" mı?** Ayarlar panelinde Bildirimler rozeti **Açık** olmalı. Değilse **Aç**'a dokunun.
5. **Test bildirimi geliyor mu?**
   - **Geliyorsa** sorun zamanlayıcıdadır: Cloudflare'de Worker › Settings › Trigger Events altında `* * * * *` cron'unun ekli olduğundan emin olun.
   - **Gelmiyorsa** ve "Abonelik yenilenmeli" yazıyorsa: **Aç**'a tekrar dokunun.
   - "Test bildirimi gönderilemedi" diyorsa birkaç dakika sonra tekrar deneyin.
6. **Odak modu kapalı mı?** Denetim Merkezi'nde ay simgesi açıksa kapatıp tekrar deneyin.
7. **KV bağlaması doğru mu?** Tarayıcıda `.../api/config` adresini açın. `kv_missing` görürseniz 4b adımını tekrarlayın (değişken adı tam olarak `KV`).
8. **Cloudflare kayıtlarına bakın:** Worker › **Logs** (veya "Observability") bölümünde cron çalışmalarını görebilirsiniz. Her dakika bir kayıt olmalı.
9. **Hâlâ olmuyorsa:** Uygulamayı ana ekrandan silin, Safari'de adresi tekrar açıp 7–9. adımları baştan yapın.

### Diğer sorunlar

- **"Bu zaman geçmişte kaldı" diyor:** Kartta saati ya da tarihi ileri bir zamana alın.
- **Saat yanlış anlaşıldı:** Kartta saate dokunup tekerlekten düzeltin. "akşam 7", "sabah 9" gibi gün bölümü söylemek belirsizliği giderir.
- **Kod güncellemesi:** Yeni bir `worker.js` gelirse 3. adımı tekrarlayın. Verileriniz KV'de kalır, uygulama bir sonraki açılışta kendini günceller.

### İsteğe bağlı ayar

Worker › Settings › **Variables** altına `VAPID_SUBJECT` adında, değeri `mailto:siz@ornek.com` biçiminde bir değişken ekleyebilirsiniz. Eklemezseniz Worker adresiniz kullanılır, bu da yeterlidir.
