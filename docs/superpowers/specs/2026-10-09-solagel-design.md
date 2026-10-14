# Solagel — Solana üzerinde on-chain Agar.io (Tasarım Dokümanı)

> **Not (2026-10-14):** Bu dokümanın yerini [`2026-10-14-slana-design.md`](2026-10-14-slana-design.md) aldı (oyun adı Slana; token odaları, Slana Pass NFT, yeni arayüz).

Tarih: 2026-10-09 · Durum: Uygulamaya alındı (kullanıcı tasarım kararlarını bize bıraktı: "tasarımları sen yap … tam kur sistemi")

## 1. Talep ve anlayış

**Kullanıcının söyledikleri**
- Agar.io'nun Solana mainnet üzerinde çalışan on-chain versiyonu.
- Tasarımları biz yapacağız; çok tatlı (cute) ve coin temalı olacak.
- Ek özellikler, özellikle leaderboard.
- Arayüz iyi ayarlanmış olacak.
- Gerçek oyuncu yokken zeki botlar oynayacak.
- "Tam kur sistemi": uçtan uca çalışan bir sistem.

**Varsayımlarımız (değiştirilebilir)**
- "On-chain" = **hibrit mimari**: gerçek zamanlı fizik (30 Hz) Solana L1'de çalışamaz (≈400 ms slot, işlem başı ücret, hesaplama limitleri). Bu yüzden oyun döngüsü yetkili (authoritative) bir oyun sunucusunda; **para, kimlik, istatistik, sezon sıralaması ve ödüller on-chain** (Anchor programı).
- İki mod: **Ücretsiz Oyun** (cüzdansız/misafir; botlu) ve **Yüksek Bahis (Stake) Arenaları** (SOL ile giriş, rakip yedikçe onun değerini al, istediğinde "cash-out"). Stake arenalarında **bot yok** (botlar gerçek parayla oynamaz).
- Program mainnet için hazırlanır; ilk dağıtım devnet'te denenir. Dağıtım için SOL ve anahtarlar kullanıcıda olduğundan **biz mainnet'e dağıtım yapmıyoruz**; script + rehber sağlıyoruz.
- Gerçek parayla oynanan oyunlar bazı ülkelerde lisans gerektirebilir; stake modu bir yapılandırma bayrağıyla açılıp kapanır ve README'de uyarı yer alır.

**Başarı kriterleri**
- `pnpm dev` ile yerelde: sunucu + istemci açılır, cüzdansız oyuna girilir, botlar akıllıca oynar, leaderboard'lar dolar.
- Yerel validator'da program dağıtılınca: cüzdanla profil oluşturma, stake arenaya giriş, ölüm/cash-out sonrası on-chain ödeme ve sezon leaderboard'u güncellenir.
- Program testleri (LiteSVM), sunucu ve paylaşılan paket testleri yeşil.

## 2. Mimari

```
┌──────────────┐  WebSocket (ikili snapshot + JSON kontrol)  ┌────────────────────┐
│  Web istemci │ ◀─────────────────────────────────────────▶ │  Oyun sunucusu     │
│  Vite+React  │                                             │  Node 22 + ws      │
│  Canvas 2D   │──── REST (leaderboard, sezon, odalar) ─────▶│  30 Hz simülasyon  │
└──────┬───────┘                                             │  Botlar, odalar    │
       │ cüzdan imzalı tx (profil, skin, arenaya giriş)       │  Settlement kuyruğu│
       ▼                                                     └─────────┬──────────┘
┌──────────────────────────────────────────────┐   sunucu imzalı tx   │
│ Solana programı `solagel` (Anchor 1.2, sBPFv3)│◀─────────────────────┘
│ Config · PlayerProfile · Arena(kasa) · Session│  (settle_session, record_game)
│ Season(leaderboard + ödül havuzu)            │
└──────────────────────────────────────────────┘
```

Monorepo (pnpm workspaces):

| Paket | İçerik |
|---|---|
| `programs/solagel` | Anchor programı + LiteSVM testleri |
| `packages/shared` | Oyun sabitleri, formüller, ikili protokol codec'i, skin kataloğu, emote/arena meta verisi |
| `packages/sdk` | Program istemcisi: IDL, PDA yardımcıları, instruction builder'lar, hesap okuyucular, admin CLI |
| `apps/server` | Oyun sunucusu: simülasyon, odalar, botlar, auth, zincir servisi, REST |
| `apps/web` | İstemci: canvas renderer, React arayüzü, cüzdan entegrasyonu, ses, i18n (TR/EN) |

## 3. Oyun tasarımı

### 3.1 Tema: "Jelly coin'ler"
- Oyuncular **jöle gibi sallanan sevimli coin'ler** (ad: Solagel = Sol + agar jeli). Her hücre: metalik coin kenarı, kabartma iç halka, ortada sembol, kocaman parlak gözler (gözbebekleri hareket yönüne bakar), pembe yanaklar, küçük gülümseme.
- **Yüz ifadeleri**: yakında daha büyük tehdit varsa korkmuş (>_<), yenebilecek av varsa iştahlı (ağız "O"), normalde mutlu; rastgele göz kırpma.
- **Yem = "lamport"lar**: pastel renkli minik coin'ler ve mücevherler; nadir **altın coin** daha çok kütle verir.
- **Virüs = "Rug Kaktüsü" 🌵**: dikenli yeşil kaktüs. Büyükken çarparsan "rug"lanırsın (parçalara bölünürsün). Küçükken arkasına saklanabilirsin. 7-8 kez kütle fırlatınca yeni kaktüs fırlatır.
- **Fırlatılan kütle = "tip"**: oyuncu renginde minik coin.
- Arka plan: krem/pastel zemin, lavanta ızgara, şeker çizgili dünya sınırı. Koyu mod ("Night Market") seçeneği.
- UI stili: kalın mor kontur, sert gölgeli yuvarlak kartlar (sticker görünümü), Fredoka fontu, palet: krem `#FFF6E9`, mürekkep `#3D2C5E`, altın `#FFC93C`, Solana moru `#9945FF`, nane `#14F195`, pembe `#FF8FB8`, gök `#7CC8FF`.

### 3.2 Mekanikler (sabitler `packages/shared/src/constants.ts` içinde, ayarlanabilir)
- Yarıçap `r = 10·√m`. Başlangıç kütlesi 20. Hız `v = K·r^-0.44` (küçük hızlı, büyük yavaş).
- **Yeme**: kütle oranı ≥ 1.25 ve merkez mesafesi `< r_büyük − 0.4·r_küçük`.
- **Bölünme (Space)**: kütle ≥ 35 olan her hücre ikiye ayrılır, yeni yarı fareye doğru fırlatılır; en fazla 16 hücre. Birleşme süresi `12 s + 0.015·m`.
- **Kütle fırlatma (W)**: −18 kütle, 14 kütlelik "tip".
- **Kaktüs**: kütle 100; kütlesi kaktüsün 1.33 katından büyük hücre değerse patlar → kütlenin yarısı 15'e kadar parçaya saçılır.
- **Kütle erimesi**: 150 kütle üstü saniyede %0.15. Hücre başı maksimum 12 000 kütle (aşarsa otomatik bölünür).
- **Ekstra özellikler**:
  - **Airdrop'lar** 🪂: paraşütle düşen kutular; içinden 🧲 Mıknatıs (yemleri çeker, 10 s), 🚀 Pump (+%40 hız, 6 s), 🛡️ HODL kalkanı (yenemezsin/yenilemezsin, 8 s), 💰 Bag (+kütle).
  - **Coin Yağmuru** 🌧️: her ~4 dakikada 25 saniyelik altın coin bolluğu, banner ile duyurulur.
  - **Emote'lar** (1-8 tuşları): GM, WAGMI, 🚀, 💎🙌, 😭, 😋, 🫡, ❤️ — hücrenin üstünde konuşma balonu.
  - **Sohbet** (Enter), **öldürme akışı** (kill feed), **izleme modu** (lider takibi), **özel odalar** (5 haneli kod).
  - **Mini harita**: kendi konumun + ilk 3 oyuncunun taç işaretleri.
  - **Mobil**: sanal joystick + bölünme/fırlatma/cash-out butonları.
  - **Sesler**: WebAudio ile sentezlenmiş sevimli efektler (asset gerekmez).
  - **TR/EN dil** desteği, ayarlar (isim/kütle göster, koyu mod, jöle kalitesi, ses, FPS).

### 3.3 Skin'ler (24 adet, tamamen özgün çizim — gerçek token logoları kullanılmaz)
- 0–7 **ücretsiz**: Solly, Goldie, Penny, Minty, Bubbles, Skye, Zesty, Grape.
- 8–15 **seviye kilidi** (on-chain XP'den): Bitsy (2), Ethy (3), Doggo (5), Froggy (7), Hattie (10), Moonie (13), Rocket (16), Whale (20).
- 16–23 **premium** (on-chain satın alma, varsayılan 0.05 SOL → hazine): Diamond Hands, Laser Eyes, King Coin, Ninja, Rainbow, Ghosty, Bull, Bear.
- Seviye: `level = 1 + ⌊√(xp/50)⌋`.

### 3.4 Oyun modları ve odalar
- **Free Play**: herkese açık odalar (40 insan kapasiteli, dolunca yenisi açılır), botlu.
- **Özel oda**: kodla katılım, isteğe bağlı botlar, boş kalınca kapanır.
- **Stake arenaları** (zincirdeki her arena için bir oda): Penny Pond ◎0.01, Silver Stream ◎0.05, Golden Lake ◎0.1. Bot yok.
  - Herkes eşit kütle ve `değer = buy_in` ile başlar. Bir hücre yendiğinde değer **kütle oranında** aktarılır: `t = ⌊V_b · m_yenen / M_b⌋` (tam sayı lamport, toplam korunur). Son hücre yenirse tüm değer aktarılır.
  - Yem kütle verir, değer vermez.
  - **Cash-out (C)**: 3 saniye kanal; bu sürede hücrelerinden biri yenirse iptal. Başarılıysa sunucu `settle_session` ile ödemeyi zincirde yapar.
  - Bağlantı koparsa hücreler 45 s dünyada kalır (yenebilir); dönmezse otomatik cash-out.
  - Ücret: **yalnızca kârdan %5** (`fee_bps=500`); ücretin yarısı sezon ödül havuzuna, yarısı hazineye.

### 3.5 Akıllı botlar
- Popülasyon: `bot = clamp(18 − insan, 3, 18)`; insan geldikçe botlar ölünce yeniden doğmaz, ayrılınca geri gelir. Oda izleyicisiz 60 s kalırsa simülasyon uyur.
- **Bağlam yönlendirme (context steering)**: 24 yönlük ilgi/tehlike haritaları. İlgi: yem yoğunluğu (koni içinde, mesafeyle azalan), av değeri, power-up; tehlike: tehditlerin gelecekteki konuma yakınlığı (tehdidin bölünme menzili dahil), duvarlar, (büyüksen) kaktüsler. Küçükken tehdit varsa kaktüs arkası saklanma ilgisi.
- **Bölünerek avlama**: av, `m/2 ≥ 1.25·m_av` ve bölünme menzilindeyse ve yakında yarıları yiyebilecek tehdit yoksa, avın gelecekteki konumuna nişan alıp böl.
- **Birleşme**: tehlike/av yokken kütle merkezine toplanma.
- **Kişilikler**: çiftçi, avcı, korkak, dengeli; zorluk karışımı (%40 kolay, %40 orta, %20 zor) → tepki süresi (100–300 ms), nişan hatası, bölünme cesareti.
- Sevimli isimler (`gm_gummy`, `hodl_hamster`, `moon_mochi` …), rastgele skin'ler, ara sıra emote (av sonrası 😋, zirvede 👑).

## 4. On-chain program (`solagel`)

### 4.1 Hesaplar (PDA tohumları)
- `Config ["config"]`: admin, server_authority, treasury, fee_bps (≤1000), season_share_bps, skin_price, current_season, paused, sayaçlar.
- `PlayerProfile ["profile", owner]`: isim (≤16 bayt UTF-8), skin, premium skin bit maskesi, xp, oyun/öldürme/en iyi skor, sezon puanı, stake istatistikleri, zaman damgaları.
- `Arena ["arena", id_u16_le]`: buy_in, max_players, enabled, open_sessions, toplamlar. **Arena hesabının kira-üstü lamport'ları = kasa (pot)**; program sahibi olduğundan doğrudan lamport aktarılır.
- `Session ["session", arena, player]`: oyuncu, arena, buy_in, açılış zamanı, id. Oyuncu başına arena başına tek açık oturum.
- `Season ["season", id_u32_le]`: 20 kişilik sıralı leaderboard (oyuncu, puan, en iyi skor, isim, skin), finalized, prize_pool, claimed_mask. **Kira-üstü lamport'lar = ödül havuzu.**

### 4.2 Talimatlar
| Talimat | Yetki | Açıklama |
|---|---|---|
| `initialize` | programın **upgrade authority**'si | Config + Sezon 1 oluşturur (front-running'i engeller) |
| `update_config` | admin | yetkiler, ücretler, fiyat, pause |
| `create_arena` / `update_arena` | admin | arena kademeleri |
| `register_player` | oyuncu | profil (ücretsiz skin ile) |
| `update_profile` | oyuncu | isim/skin (kilit kontrolü on-chain) |
| `buy_skin` | oyuncu | premium skin; SOL hazineye |
| `join_arena` | oyuncu | buy_in arenaya, Session oluşur |
| `settle_session` | server_authority | ödeme (kârdan ücret), istatistik, XP, sezon puanı, leaderboard; Session kapanır |
| `record_game` | server_authority | ücretsiz oyun istatistiği/XP/sezon puanı |
| `refund_session` | oyuncu | 24 saat settle edilmemiş oturumda `min(buy_in, pot)` iade (sunucu çökmesine karşı son çare) |
| `fund_season` | herkes | ödül havuzuna bağış |
| `end_season` | admin | sezonu dondurur, havuzu sabitler, yeni sezonu açar |
| `claim_season_reward` | ilk 10 | paylar: 30/20/14/10/8/6/4.5/3/2.5/2 % |
| `rollover_season` | admin | 30 günlük talep süresinden sonra kalanı aktif sezona aktarır |
| `sweep_arena` | admin | açık oturum yokken arena artığını hazineye |

### 4.3 Güvenlik ve güven modeli
- Tüm para hareketleri zincirde ve denetlenebilir; **oyun sonucunun doğruluğu sunucuya güvenir** (sunucu hakemdir). Bu, gerçek zamanlı oyunlar için standart hibrit modeldir; ileride MagicBlock ephemeral rollup'larla doğrulanabilir oynanışa geçilebilir.
- `settle_session` ödemesi arena kasasını aşamaz; kasa her zaman kira-muaf kalır; tüm aritmetik `checked_*`.
- Sunucu anahtarı ele geçirilirse etkisi: arena kasaları. Önlemler: `paused`, anahtar rotasyonu (`update_config`), sunucu cüzdanında minimum SOL, izleme. Mainnet öncesi bağımsız denetim önerilir.
- Sunucu, oturum yaşını 6 saatte zorla cash-out'a bağlar (24 saatlik iade süresinin çok altında) → iade/oyun çifte harcama penceresi kapanır.
- Hiç bağlanmayan oturumları sunucu 15 dakika sonra `payout = buy_in` ile iade eder.

## 5. Sunucu

- `node:http` + `ws`. REST: `/api/health`, `/api/rooms`, `/api/leaderboard` (günlük/tüm zamanlar), `/api/season` (zincirden 30 s önbellekli), `/api/auth/nonce`.
- **Protokol**: istemci → sunucu ikili girdi (hedef, böl, fırlat) + JSON kontrol (join, auth, chat, emote, cashout, spectate, viewport). Sunucu → istemci ikili **delta snapshot** (yalnızca görüş alanındaki varlıklar; yem bir kez gönderilir; hareketli varlıklar her tick; kaldırmalarda "yiyen" kimliği → yeme animasyonu) + JSON (leaderboard 1 Hz, kill feed, chat, olaylar, ölüm istatistikleri, cash-out durumu).
- **Uzamsal ızgara** (256 birim hücre) ile çarpışma/görüş sorguları.
- **Auth**: Sign-In-With-Solana tarzı mesaj + ed25519 doğrulama (tweetnacl), tek kullanımlık nonce; sonrasında 24 saatlik HMAC token (tekrar imza gerekmez).
- **Zincir servisi**: profil önbelleği (skin/isim doğrulama), oturum doğrulama, **kalıcı settlement kuyruğu** (`data/journal.json`, atomik yazma). Her settle olayında ve 2 s'de bir tüm canlı stake değerleriyle anlık görüntü yazılır; yeniden başlatmada canlı oyuncular son değerleriyle otomatik cash-out edilir → kasa korunumu.
- Zincir yapılandırılmamışsa (PROGRAM_ID/anahtar yok) sunucu yalnızca ücretsiz modla çalışır.
- Hız sınırları, girdi doğrulama, IP başına bağlantı limiti, sohbet filtresi.

## 6. İstemci

- Vite + React 19 + TypeScript; oyun döngüsü React dışında (`GameEngine`), HUD durumu küçük bir store ile ~10 Hz güncellenir.
- Renderer: önceden çizilmiş sprite'lar (yem, kaktüs), jöle poligon hücreler, LOD (küçük hücrelerde yüz yok), ara değerleme (interpolation), yumuşak kamera/zoom, partiküller (yeme pırıltısı, bölünme pufu, kaktüs konfetisi, coin yağmuru).
- Ekranlar: Lobi (canlı arena arka planı), skin karuseli, mod sekmeleri, leaderboard paneli (Sezon on-chain / Bugün / Tüm zamanlar), profil kartı (seviye, XP), skin dükkanı, profil oluştur/düzenle, ayarlar, nasıl oynanır, ölüm ekranı, cash-out başarı ekranı (konfeti + explorer linki).
- Cüzdan: `@solana/wallet-adapter-react` (Wallet Standard ile Phantom/Solflare/Backpack otomatik), kendi tasarımımız olan cüzdan modalı.
- Program dağıtılmamışsa on-chain özellikler zarifçe "çevrimdışı" gösterilir; oyun yine oynanır.

## 7. Test stratejisi
- Program: LiteSVM ile Rust entegrasyon testleri (yetki, ücret matematiği, kasa korunumu, iade zaman aşımı, leaderboard sıralaması, ödül talebi, skin kilitleri, pause).
- Shared: codec gidiş-dönüş, formüller.
- Sunucu: fizik kuralları (yeme, bölünme, birleşme, kaktüs patlaması), stake değer korunumu (rastgele yemelerde toplam sabit), journal kurtarma, başsız bot simülasyonu (binlerce tick: NaN yok, botlar büyüyor, popülasyon stabil).
- İstemci: tip kontrolü + build; Playwright ile ekran görüntüleri.
- Uçtan uca: yerel validator + dağıtım + admin init + sunucu + gerçek tx akışı.

## 8. Kapsam dışı (şimdilik)
- Doğrulanabilir zincir-üstü fizik (ephemeral rollup), SPL token ile stake, NFT skin'ler, takımlar/klanlar, turnuva braketi, sunucular arası ölçekleme (tek süreç birden çok oda çalıştırır).
