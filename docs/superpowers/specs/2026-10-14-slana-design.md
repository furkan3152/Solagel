# Slana — Tasarım Dokümanı (v2)

Tarih: 2026-10-14 · Durum: Kullanıcı onayladı (sohbette, bölüm bölüm) · Önceki: `2026-10-09-solagel-design.md` (bu doküman onun yerini alır)

---

## 1. Talep ve kararlar

**Kullanıcının söyledikleri (2026-10-14):**
- Oyunun adı **Slana**. Mantık değişiyor: **geniş, 7/24 oynanan odalar**.
- Odalara giriş için pump.fun'da çıkan token gerekir; **her odanın net bir giriş bedeli** var; **herkes yediği kişinin tokenlerini alır**.
- **Ekipten para çıkmamalı; para kullanıcılar arasında dönmeli.**
- NFT'ler **ana skinler** olacak ve **Slana Pass**'e erişim sağlayacak. Avantajlar ekipten para çıkmadan sağlanmalı. NFT olmadan oynanamayan odalar olacak (oda oda değişir) ve NFT'nin **net avantajı** olmalı.
- Arayüz baştan elden geçirilecek, **"yapay zekâ görünümü"nden kurtarılacak**. Animasyon ve tasarımlar özenli olacak.
- Eşleştirme ve bot sistemi iyi ayarlanacak. Dokümanlar hazırlanacak.

**Sorularla netleşen kararlar:**

| Konu | Karar |
|---|---|
| NFT avantajları | Pass odaları + daha düşük kesinti + sezon ödülü hakkı + oyun içi güç (riskler anlatıldı, kullanıcı bilerek seçti) |
| Antrenman | Olacak: ücretsiz, tokensiz, NFT'siz, botlarla, ödülsüz |
| NFT ağı / mint | Solana (Metaplex Core), **kendi mint sayfamızda ücretsiz mint**; NFT'ler OpenSea/Magic Eden/Tensor'da işlem görür. OpenSea Studio Solana mint desteklemediği için bu yol seçildi. |
| NFT görselleri | Biz tasarlıyoruz (oyunun çizim koduyla üretilen benzersiz coin karakterleri) |
| Token sembolü | **$SLANA** (mint adresi kurulumda bir kez girilir) |
| Görsel yön | **B · Kâğıt Bilet** (risograf baskı; tasarım tuvali: https://claude.ai/artifact/3tFjCisE9AAC94Yw3w4SL8) |
| Önceki $SOGEL planı | Tamamen bu dokümanla değişti: ekip fonlu ödül kasası, görevler, ücretsiz mod boostları ve SOL arenaları **yok** |

**Varsayımlar (değiştirilebilir ayarlar):** kesinti %5 (Pass %2); bölüşüm %50 hazine / %30 sezon / %20 yakım; Pass gücü +%15 başlangıç kütlesi ve 2 sn cash-out; koleksiyon arzı 3.333, cüzdan başı 1 mint; oda bedelleri örnek değerlerdir.

---

## 2. Oyuncunun gözünden

1. Siteye girer, **Antrenman**'da cüzdansız ve ücretsiz botlarla oynar.
2. Cüzdan bağlar. $SLANA alır (pump.fun / DEX). İsterse **Slana Pass başvurusu** yapar: ücretsiz mint, sadece ağ ücreti.
3. Lobide odalar **giriş biletleri** olarak listelenir: bedel, oyuncu sayısı, "PASS" damgası, Pass avantajı satırı.
4. Bilet alır: tek imza. Bedel odanın kasasına gider; oyundaki değeri bu bedeldir.
5. Oynar. Yediği oyuncunun tokenlerini alır. Bir bot onu yerse tokenleri haritaya altın coin olarak saçılır.
6. İstediği an **C** ile cash-out yapar; ödeme makbuzu basılır. Kârdan kesinti düşülür, kalan cüzdanına gelir.
7. Pass sahibiyse sezon puanı toplar. Sezon sonunda ilk 10, oyuncu kesintilerinden dolan havuzu paylaşır.

---

## 3. Ekonomi

### 3.1 Odalar (arenalar)
- Her **arena** zincirde bir hesap. Alanları: sabit `entry_fee` ($SLANA taban birimi), `requires_pass`, `max_sessions` (aynı anda açık bilet sınırı), `enabled`.
- Bir arenanın kasası, arena PDA'sına ait bir token hesabıdır: `["vault", arena]`.
- Sunucu her arena için **oda örnekleri (shard)** çalıştırır: örnek başına en fazla **50 gerçek oyuncu**. Örnek doluysa aynı kasayı kullanan yeni bir örnek açılır.
- Paralı odalar 7/24 açıktır; boşken botlar oynar. Harita **6400×6400**; yem ve kaktüs sayısı buna göre ölçeklenir.
- Varsayılan arenalar (`pnpm admin create-arena --defaults`, tutarlar örnektir):

| id | Ad | Bedel | Pass |
|---|---|---|---|
| 1 | Kuruş Gölü | 1.000 $SLANA | gerekmez |
| 2 | Gümüş Dere | 10.000 $SLANA | gerekmez |
| 3 | Altın Göl | 50.000 $SLANA | gerekli |
| 4 | Balina Koyu | 250.000 $SLANA | gerekli |

- `entry_fee` ve `requires_pass` yalnızca arenada açık bilet yokken değiştirilebilir.

### 3.2 Değer akışı (oyun içi defter)
- **Giriş:** oyuncunun değeri `V = entry_fee`.
- **Yeme:** hücre yenince değerin orantılı payı yiyene geçer: `t = floor(V_kurban · m_hücre / M_kurban)`. Son hücre yenince kalan değerin tamamı geçer. Bu kural mevcut defterden aynen korunur.
- **Botların değeri her zaman 0'dır:**
  - Bot yemek kütle verir, token vermez.
  - Bir bot bir oyuncunun **son** hücresini yerse, oyuncunun kalan değeri **ganimet coinlerine** dönüşür ve ölüm noktasına saçılır.
  - Bir bot oyuncunun hücrelerinden birini yerse, o hücrenin değer payı ganimet olur.
- **Ganimet coinleri:**
  - Kurbanın değeri `n = clamp(ceil(V / (entry_fee/4)), 3, 24)` parçaya bölünür; parçaların toplamı tam olarak `V` eder, kalan küsurat ilk parçaya eklenir.
  - Parçalar dışarı doğru fırlar, sürtünmeyle yavaşlar ve haritada kalır; kendiliğinden kaybolmaz.
  - Yalnızca **gerçek oyuncular** toplayabilir; botlar içinden geçer. Toplanan parçanın değeri toplayanın defterine eklenir.
- **Korunum (değişmez):** bir arena için `Σ canlı değerler + Σ ganimet = kasa bakiyesi − (bekleyen ödemeler)`. Bunu test eden bir simülasyon testi yazılır.
- **Ejekt (W), kaktüs patlaması, kütle erimesi** değeri değiştirmez.
- **AFK / bağlantı kopması:** hücre 45 sn boyunca dünyada kalır, sonra otomatik cash-out olur. Bağlantı geri gelirse oyuncu hücresine döner. Bu davranış mevcut koddan korunur.
- **Oturum yaşı:** sunucu en fazla 6 saatte otomatik cash-out yapar.

### 3.3 Cash-out ve kesinti
- Cash-out normalde **3 sn**, Pass'li bilette **2 sn** sürer; bu sırada yenilirsen kaybedersin. Süre sunucu ayarıdır.
- **Kesinti sadece kârdan alınır:** `kâr = max(0, ödeme − entry_fee)`. Oran `fee_bps` (varsayılan 500 = %5); Pass'li bilette `pass_fee_bps` (varsayılan 200 = %2). Üst sınır 1000 (%10).
- Kesinti üçe bölünür; payların toplamı 10.000 olmak zorundadır:
  - `treasury_bps` (varsayılan 5000): **hazine kasasına** gider. Bu, programa ait bir token hesabıdır; yönetici `withdraw_treasury` ile çeker.
  - `season_bps` (3000): **sezon kasasına**.
  - `burn_bps` (2000): **yakılır** (token arzından düşer).
- Yuvarlama: önce `fee = floor(kâr · bps / 10000)`, sonra paylar `floor(...)`; küsurat sezon kasasına gider. Tüm aritmetik taşma kontrollüdür.

### 3.4 "Ekipten para çıkmaz" kuralı

| Akış | Kim öder |
|---|---|
| Bilet bedeli | Oyuncu |
| Oturum hesabı kirası (≈◎0.0017) | Oyuncu; kapanınca **oyuncuya geri döner** |
| Ödeme (settle) işleminin ağ ücreti | Oyuncunun bilet **depozitosu**: oturum hesabına kiradan fazla `settle_fee_lamports` (varsayılan 20.000 lamport ≈ ◎0.00002) yatırılır; settle sırasında sunucuya aktarılır. Sunucu cüzdanı net para harcamaz. |
| Sezon ödülleri | Oyuncu kesintilerinden dolan sezon kasası |
| Bot kaynaklı kayıplar | Haritaya ganimet olarak döner (oyunculara) |
| Kapatılan arenanın artığı | `sweep_arena` → sezon kasası (oyunculara) |
| NFT mint | Mint eden öder: Core varlık kirası + işlem ücreti |
| Kalan tek seferlik giderler | Program dağıtım kirası, koleksiyon oluşturma, arena/kasa hesapları, sunucu barındırma. Bunlar altyapı maliyetidir ve dokümanlarda yazar. |

Ekibin geliri: kesintinin hazine payı ve NFT ikincil satış telifi (koleksiyon telif eklentisi, varsayılan %5).

### 3.5 Sezonlar
- Sezon puanı **yalnızca Pass'li biletlerle** oynanan oyunlardan gelir: `session.has_pass` bilet alınırken anlık kaydedilir. Puan = oyunun skoru (en yüksek kütle, üst sınırlı).
- Sezon tablosu ilk 20'dir. Sezon bitince (`end_season`) havuz dondurulur, ilk 10 şu paylarla talep eder: %30 / %20 / %14 / %10 / %8 / %6 / %4,5 / %3 / %2,5 / %2. Talep süresi 30 gün.
- Talep edilmeyenler `rollover_season` ile aktif sezona aktarılır.
- Tek bir global sezon kasası vardır: `["season_vault"]`. Sezonlar kendi havuzlarını muhasebe olarak tutar.
- **Değişmez:** `Σ bekleyen ödüller + aktif havuz ≤ sezon kasası bakiyesi`.
- `fund_season` kaldırılır: ekip havuz fonlamaz.

### 3.6 Antrenman
- Tamamen zincir dışıdır: token, NFT ve cüzdan gerekmez; ödül, sezon puanı ve zincir kaydı yoktur.
- Sunucu kendi "Bugün / Tüm zamanlar" tablolarını tutmaya devam eder; bu tablolar yalnızca antrenman ve görünüm içindir.
- **Ligler:**
  - **Çaylak:** seviyesi 5'in altında olanlar ve cüzdansızlar. Bot karışımı %70 kolay, %30 orta.
  - **Usta:** seviye 5 ve üstü. Mevcut karışım %45/%40/%15.
  - Çaylak odasında bir oyunda kütlesi 3.000'i aşan ya da 8 oyuncu yiyen, 24 saat boyunca Usta'ya yönlendirilir. Bu bilgi sunucu belleğinde, imzalı oturum jetonu ya da IP ile tutulur.

---

## 4. Slana Pass (NFT)

### 4.1 Koleksiyon ve ücretsiz mint
- Standart: **Metaplex Core** (`CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d`).
- Koleksiyonun güncelleme yetkilisi programımızın PDA'sıdır: `["pass_authority"]`. Bu sayede mint'i yalnızca program yapabilir.
- Koleksiyonu yönetici script'i oluşturur: `pnpm admin create-collection --uri … --royalty-bps 500`. Koleksiyona Royalties eklentisi (alıcı: hazine sahibi) eklenir. Ardından `set_pass_collection` çağrılır; bu **bir kez** yapılır ve program koleksiyonun gerçekten Core `CollectionV1` olduğunu ve yetkilinin PDA olduğunu doğrular.
- `mint_pass` talimatı (herkes çağırabilir):
  - **Koşullar:**
    - mint açık olmalı (`pass_mint_open`, `pass_mint_start_ts`);
    - `pass_minted < pass_supply` (varsayılan 3.333);
    - cüzdan başı sınır `pass_per_wallet` (varsayılan 1). Sayaç `["pass_minted", cüzdan]` PDA'sında tutulur.
    - İsteğe bağlı bot filtresi: `pass_min_tokens` (varsayılan 0): cüzdanda en az bu kadar $SLANA olmalı.
  - **CPI:** Core `CreateV2` (ayırıcı `20`). Varlık yeni bir keypair'dir (mint eden imzalar). Ad `Slana Pass #<n>`, URI `pass_base_uri + n + ".json"`, sahip mint eden, koleksiyon bizim koleksiyon. `n = pass_minted + 1`, yani sıralıdır.
  - **Ücret:** yok. Mint eden varlık kirasını ve `pass_minted` PDA kirasını öder.
- **Adil dağıtım (commit–reveal):**
  - Mint açılmadan önce `pass_seed_hash = sha256(seed)` zincire yazılır.
  - Mint bitince yönetici `reveal_pass(seed)` çağırır; program hash'i doğrular ve tohumu yayınlar.
  - Özellikler `traits(seed, n)` ile hesaplanır; kimse hangi numaranın nadir olduğunu önceden bilemez.
  - Açılmadan önce tüm Pass'ler oyunda ve pazar yerlerinde "mühürlü pasaport" olarak görünür.
- **Metadata barındırma:** varsayılan olarak oyun sunucusu servis eder:
  - `GET /pass/:n.json` ve `GET /pass/:n.png`; açılmadan önce "mühürlü" içerik döner.
  - `GET /pass/collection.json`.
  - `pass_base_uri = https://<alan-adı>/pass/`.
  - Görseller ilk istekte NFT aracının çizim koduyla üretilir ve diske önbelleklenir.
  - Arweave'e yüklemek isteyenler için alternatif dokümanda anlatılır.

### 4.2 Pass avantajları

| Avantaj | Nerede uygulanır |
|---|---|
| Pass odalarına giriş | **Zincirde**: `join_arena`, Core varlığını okur (sahip = oyuncu, koleksiyon = bizimki); yoksa bilet alınamaz |
| %2 kesinti | **Zincirde**: `settle_session`, `session.has_pass` ise `pass_fee_bps` kullanır |
| Sezon ödülü hakkı | **Zincirde**: puan yalnızca `has_pass` oturumlardan |
| +%15 başlangıç kütlesi, 2 sn cash-out | **Sunucuda**: oturumda `has_pass` ise. Değerler ayarlanabilir (`PASS_START_MASS_MUL=1.15`, `PASS_CASHOUT_MS=2000`). Oda biletinde açıkça yazar: "Pass sahipleri +%15 başlar, 2 sn'de çıkar". |
| NFT ana skin | **Sunucuda**: sahiplik doğrulanır, özellikler oyunda çizilir |

- **Bir NFT tek oturumda:** `join_arena`, Pass kullanılıyorsa `["pass_lock", varlık]` PDA'sını oluşturur. Settle ya da iade olunca kapanır ve kirası oyuncuya döner. Aynı NFT ile ikinci bir bilet açılamaz. NFT oyun sırasında devredilse bile yeni sahip, kilit kalkana kadar onu kullanamaz.
- Pass'siz odada Pass kullanmak isteğe bağlıdır (`use_pass`). Kullanılırsa kilit ve avantajlar devreye girer.

### 4.3 NFT görsel sistemi (özellikler)
Her Pass, oyundaki çizim koduyla üretilmiş bir **risograf coin karakteridir**. Aynı kod oyunda, mint sayfasında ve metadata görselinde kullanılır.

| Katman | Seçenekler (ağırlıklar generator'da) |
|---|---|
| Mürekkep (gövde) | 12 riso mürekkebi: Fluo Pembe, Deniz Mavisi, Hardal, Mavi, Yeşil, Turuncu, Mor, Kırmızı, Su, Leylak, Nane, Kahve |
| Baskı kayması (ikinci renk) | 6 renk, kayma yönü/miktarı |
| Sembol (ortada) | ◎, kalp, yıldız, şimşek, ay, çiçek, taç, dolar, yonca, elmas (vektör) |
| Gözler | yuvarlak, uykulu, yıldız, göz kırpma, güneş gözlüğü, kalp, kararlı, baş dönmesi |
| Ağız | gülüş, sırıtma, "o", dil, kedi, sivri diş |
| Aksesuar | yok, taç, kep, bere, hale, pervaneli şapka, kulaklık, parti şapkası, kovboy, çiçek, defne, boynuz |
| Kâğıt (arka plan) | krem, pembe, nane, gök, tereyağı, leylak |
| Özel (Efsane) | altın varak kenar, hologram, 1/1 el yapımı (10 adet) |

- Nadirlik: Yaygın / Nadir / Efsane. Ağırlıkların çarpımından hesaplanır; eşikler generator'da sabittir.
- Aynı kombinasyon iki kez çıkmaz (tekrar ayıklanır).
- `traits(seed, n)` deterministiktir: sunucu, istemci ve generator aynı fonksiyonu `packages/shared` içinden kullanır.

---

## 5. Zincir programı `slana` (Anchor 1.2.1)

### 5.1 Token desteği
- `anchor_spl::token_interface`: **SPL Token ve Token-2022**. Tüm transferler `transfer_checked`, yakım `burn` ile yapılır.
- `initialize`, mint'i doğrular:
  - token programı ikisinden biri olmalı;
  - `freeze_authority` olmamalı (kasa dondurulamasın);
  - Token-2022 ise şu uzantılar **reddedilir**: TransferFeeConfig, TransferHook, PermanentDelegate, NonTransferable, DefaultAccountState, ConfidentialTransferMint, Pausable. Meta veri uzantılarına izin verilir.
- Mint adresi Config'e **bir kez** yazılır ve değiştirilemez.

### 5.2 Hesaplar (PDA tohumları)
- `Config ["config"]` (yeni alanlar):
  - yetkililer: `admin`, `server_authority`;
  - token: `token_mint`, `token_program`, `token_decimals`;
  - kesinti: `fee_bps`, `pass_fee_bps`, `treasury_bps`, `season_bps`, `burn_bps`, `settle_fee_lamports`;
  - genel: `current_season`, `paused`;
  - koleksiyon ve mint: `pass_collection` (`Pubkey::default` = ayarlanmamış), `pass_base_uri` (≤ 96 bayt), `pass_supply`, `pass_minted`, `pass_per_wallet`, `pass_min_tokens`, `pass_mint_open`, `pass_mint_start_ts`, `pass_seed_hash`, `pass_seed` (açılınca), `pass_revealed`;
  - sayaçlar ve bump'lar.
- `TreasuryVault ["treasury_vault"]` ve `SeasonVault ["season_vault"]`: Config PDA yetkili token hesapları.
- `PassAuthority ["pass_authority"]`: veri tutmayan imza PDA'sı.
- `PlayerProfile ["profile", sahip]`: ad, temel skin, XP/seviye, oyun sayısı, en iyi skor, sezon puanı (sezon id'siyle). Biletten önce profil zorunludur; istemci gerekirse `register_player` ile `join_arena`'yı aynı işlemde gönderir.
- `Arena ["arena", id_u16_le]`: `id`, `entry_fee`, `requires_pass`, `max_sessions`, `open_sessions`, `enabled`, `vault`, sayaçlar.
- `ArenaVault ["vault", arena]`: Arena PDA yetkili token hesabı.
- `Session ["session", arena, oyuncu]`: `id` (benzersiz, Config sayacından), `player`, `arena`, `entry_fee`, `opened_at`, `has_pass`, `pass_asset` (yoksa default). Lamport bakiyesi kira + `settle_fee_lamports`.
- `PassLock ["pass_lock", varlık]`: `session`, `player`.
- `PassMinted ["pass_minted", cüzdan]`: `count`.
- `Season ["season", id_u32_le]`: ilk 20 tablo, `pool` (aktifken birikim), `prize_pool` (dondurulunca), `claimed_mask`, `started_at`, `ended_at`, `finalized`.

### 5.3 Talimatlar
| Talimat | İmza | Özet |
|---|---|---|
| `initialize` | upgrade authority (ProgramData) | Config + kasalar + sezon 1; mint doğrulaması |
| `update_config` | admin | kesinti/bölüşüm (toplam 10000, fee ≤ 1000), `settle_fee_lamports` ≤ 1.000.000, paused, server, admin, Pass mint parametreleri (supply ≥ minted; base URI ilk mint'ten sonra değişmez) |
| `set_pass_collection` | admin | bir kez; Core CollectionV1, yetkili = PassAuthority |
| `set_pass_seed_hash` | admin | ilk mint'ten önce |
| `mint_pass` | mint eden + yeni varlık keypair'i | 4.1 |
| `reveal_pass` | admin | sha256(seed) == hash; bir kez |
| `create_arena` / `update_arena` | admin | 3.1; kasa hesabını oluşturur |
| `register_player` / `update_profile` | oyuncu | ad (≤16 bayt UTF-8), temel skin (0–7) |
| `join_arena(arena_id, use_pass)` | oyuncu | paused/enabled/kapasite; `requires_pass` ⇒ use_pass; Pass ise Core varlık + PassLock oluştur; `transfer_checked` bedel → kasa; Session (+ depozito) |
| `settle_session(SettleArgs{session_id, payout, score, kills, xp})` | server | id eşleşmesi; `payout ≤ kasa`; kâr kesintisi (Pass oranı); hazine/sezon/yakım; ödeme → oyuncunun token hesabı; `settle_fee_lamports` → server; XP/istatistik; Pass'liyse sezon puanı + tablo; Session ve PassLock kapanır (kira oyuncuya) |
| `refund_session` | oyuncu | 24 saat sonra; `min(entry_fee, kasa)`; depozito dahil tüm lamport oyuncuya |
| `end_season`, `claim_season_reward`, `rollover_season` | admin / kazanan / admin | 3.5; ödemeler token |
| `sweep_arena` | admin | `enabled=false` ve `open_sessions=0`: kasa → sezon kasası |
| `withdraw_treasury(amount)` | admin | hazine kasası → admin'in verdiği token hesabı |

- **Kaldırılanlar:** `buy_skin`, `record_game`, `fund_season`, SOL arenaları.
- **Hata kodları:** mevcutlar korunur, yeniler eklenir: `MintNotAllowed`, `FreezeAuthorityPresent`, `PassRequired`, `PassNotOwned`, `PassWrongCollection`, `PassInUse`, `MintClosed`, `MintSoldOut`, `MintLimit`, `MintMinTokens`, `SeedMismatch`, `AlreadyRevealed`, `CollectionAlreadySet`, `BadSplit`, `ArenaBusy`, `BadBaseUri`.
- **Core varlık okuma** (bağımlılık olmadan, elle):
  - sahip program = Core;
  - `data[0] == 1` (AssetV1);
  - `owner = data[1..33]`;
  - `data[33] == 2` (UpdateAuthority::Collection) ve `data[34..66] == pass_collection`.
  - Koleksiyon için: `data[0] == 5` (CollectionV1) ve `update_authority = data[1..33]`.

### 5.4 Testler (LiteSVM)
- Kasa/oturum akışları: SPL Token ve Token-2022 mint'leriyle ayrı ayrı.
- Mint doğrulaması: dondurma yetkili mint ve transfer ücretli mint reddedilir.
- Pass kapısı: sahte Core varlık hesapları `set_account` ile kurulur. Kontroller: sahip yanlış, koleksiyon yanlış, kilit çakışması.
- Kesinti matematiği (Pass / Pass'siz, yakım arzı düşürür), settle depozitosunun sunucuya geçmesi.
- İadeler; eski ödemenin yeniden açılan oturuma uygulanamaması (`session_id`).
- Sezon puanının yalnızca Pass ile işlemesi, ödül talebi, devretme, kasa süpürme, hazine çekimi.
- `mint_pass`: Core programı test ortamına yüklenebiliyorsa gerçek CPI; yüklenemiyorsa talimat verisi ve hesap sıralaması birim testi + localnet'te klonlanmış Core ile uçtan uca test.

---

## 6. Oyun sunucusu

### 6.1 Odalar
- `RoomManager`: antrenman örnekleri (`practice-rookie-N`, `practice-pro-N`, kapasite 40) ve arena örnekleri (`arena-<id>-<n>`, 50 oyuncu).
- Arenalar zincirden 30 sn'de bir okunur; yeni arenalar lobiye kendiliğinden gelir.
- **Hızlı Oyna:** cüzdan ya da bakiye yoksa antrenmana; varsa son oynanan arenaya ya da gücünün yettiği en ucuz arenaya gider. Arenada en kalabalık, dolu olmayan örnek seçilir.
- Oda bilgisi lobiye `RoomInfo` ile gider: `arenaId`, `entryFee`, `requiresPass`, örnekler, gerçek oyuncu ve bot sayısı, ganimet toplamı ("yerde X $SLANA").

### 6.2 Botlar
- **Sayı:** antrenmanda hedef 20 varlık (min 4, max 20). Arenada hedef 24, min 2, max 16 bot. Gerçek oyuncu arttıkça botlar emekli olur.
- **Arenada:** botların değeri 0'dır, ganimet toplamazlar, "BOT" etiketi taşırlar.
- **Davranış iyileştirmeleri:**
  - **Tehdit tahmini:** rakibin bölünme menzili ve hız vektörü hesaba katılır.
  - **Kaktüs kullanımı:** saklanma ve atış korunur.
  - **Ganimetten kaçınma:** botlar ganimet coinlerini hedef almaz.
  - **Yeni gelen koruması:** gerçek oyuncuya ilk 25 sn bölünerek saldırılmaz (mevcut kural).
  - **Fırsat kovalama:** botlar küçük gerçek oyunculara normal davranır; aşırı avcılık yoktur. Kolay bot oranı lige göre değişir.
- Bot isimleri ve skinleri temel skin havuzundan gelir; NFT görünümünü yalnızca gerçek oyuncular kullanır.

### 6.3 Ganimet ve günlük (journal)
- **Yeni varlık türü:** `EntityKind.Loot` (değer + görsel boyut).
- **Günlük:** canlı bilet değerleri ve ganimet listesi oda başına atomik yazılır:
  - her ödeme kuyruğa girdiğinde;
  - değişiklik varsa en az saniyede bir.
- **Kurtarma:**
  - Çökme sonrası canlı biletler otomatik cash-out'a alınır (mevcut davranış).
  - Ganimet, ilgili arenanın ilk örneğine geri yüklenir.
  - `sweep_arena` ile süpürülmüş ya da kapatılmış arenanın ganimeti atılır.

### 6.4 Zincir geçidi (SolanaChain v2)
- Token birimleri (`decimals` mint'ten okunur). Arena listesi: bedel, Pass, kapasite.
- `getSession` yeni alanları döndürür: `hasPass`, `passAsset`.
- **Ödeme işçisi:** yeni `settle_session` hesapları. Kalıcı hatalarda (`SessionMismatch`, hesap yok) öğe atılır. Kalıcı olmayan hatalarda yeniden denenir.
- **Bayat oturum süpürücü** (15 dk) korunur. `record_game` yoluna ait kodlar kaldırılır.
- **NFT doğrulama:** `getAsset(adres)`. Varlık hesabı okunur (60 sn önbellek): sahip, koleksiyon ve `Slana Pass #n` adından `n` çıkarılır. Açılmışsa `traits(seed, n)`, açılmamışsa mühürlü görünüm kullanılır.
- **Sahip olunan Pass'lerin listesi:** `GET /api/pass/owned?wallet=` (30 sn önbellek).
  - RPC DAS destekliyorsa `getAssetsByOwner` (koleksiyona göre gruplanmış) kullanılır.
  - Desteklemiyorsa Core programına `getProgramAccounts`: `memcmp` ofset 1 = cüzdan, ofset 34 = koleksiyon.
  - İstemci bu listeyi lobide ve skin seçiminde kullanır. Sunucu ayrıca oyuna girişte seçilen tek varlığı yeniden doğrular.

### 6.5 Koruma
- Pass kullanılıyorsa arena başına cüzdan başına tek bilet ve NFT başına tek oturum (zincirde).
- Pahalı mesajlara hız sınırı: giriş, bilet, ekipman (mevcut).
- Takımlaşma tespiti bu sürümün kapsamında **değil**; riskler bölümünde yazar.

### 6.6 Metadata uç noktaları
- `/pass/:n.json`, `/pass/:n.png`, `/pass/collection.json`, `/pass/collection.png`.
- Görseller `@napi-rs/canvas` ile ilk istekte üretilir ve `DATA_DIR/pass/` altında önbelleklenir. Açılmadan önce mühürlü görsel döner.
- Uç noktalara hız sınırı uygulanır.

---

## 7. Web istemcisi — "Kâğıt Bilet" tasarım sistemi

### 7.1 Temel öğeler
- **Renkler:**
  - kâğıt `#F1EADB`, kart kâğıdı `#FFFCF4`;
  - mürekkep `#1E1B2E`, ikincil mürekkep `#5D5870`;
  - fluo pembe `#FF4F87` (yazıda `#D6245F`);
  - deniz `#0E9C9A` (yazıda `#08716F`);
  - hardal `#F2B705` (yazıda `#8A6500`);
  - riso mavi `#3B5BDB`, riso yeşil `#1F9D61`, kırmızı `#E5402B`.
  - **Gece baskısı** (koyu tema): kâğıt `#1B1924`, mürekkep `#F1EADB`, aynı vurgular.
- **Yazı:** Bricolage Grotesque (başlık ve gövde; dar genişlik ekseni) ve DM Mono (etiketler ve rakamlar). İkisi de `@fontsource` ile yerelden yüklenir.
- **Doku:** kâğıt grenini iki katman nokta deseni ve hafif `feTurbulence` verir. Gölgeler halftone noktalardır.
- **Şekiller:**
  - bilet (çentik + delik çizgisi), damga (döndürülmüş çerçeveli yazı);
  - makbuz (zikzak kenar), pasaport (kapak + sayfa);
  - bant parçaları, gazete sütunu ve kuralları (rule).
- **İkonlar:** ~32 özel SVG ikon (2.2 px çizgi, yuvarlak uçlar). **Arayüzde emoji yok**; emote'lar da çizilmiş "çıkartma"lara dönüşür.

### 7.2 Ekranlar
1. **Lobi / Biletler:**
   - başlık, cüzdan etiketi, sezon satırı (dateline);
   - Pass kartı ya da "Pass başvurusu" çağrısı;
   - bilet listesi: bedel, Pass damgası, avantaj satırı, canlı sayılar, "yerde X $SLANA";
   - Hızlı Oyna; mobilde alt sekmeler.
   - Masaüstü düzeni gazete ön sayfasıdır: solda biletler, ortada canlı oda "fotoğrafı" (oyunun canlı görüntüsü çerçeve içinde), sağda Pass ve sıralama.
2. **Bilet kesme:** onay kartı (bedel, kesinti, Pass avantajları, depozito notu) → cüzdan imzası → **damga + bileti koparma** animasyonu → oyuna giriş.
3. **Oyun içi ekran (HUD):**
   - bantla yapıştırılmış kâğıt parçaları: kasa ("KASA 12.450 $SLANA", sayaç animasyonlu), sıralama sütunu, mini harita (pafta);
   - cash-out düğmesi; makbuz yazıcı ilerlemesi; olay akışı; emote çıkartmaları; mobil joystick.
4. **Ölüm:** "YENİLDİN" damgası, kim yedi, kaybedilen değer, "Yeni bilet" / "Antrenman".
5. **Cash-out makbuzu:** yazıcıdan çıkan makbuz (giriş, kazanç, kesinti %, net) + işlem bağlantısı.
6. **Pass:**
   - **Pass sahibi:** pasaport görünümü (NFT görseli, numara, özellikler, avantajlar, kullanılan oturum).
   - **Pass'siz:** "Başvuru" sayfası (arz sayacı, damgalı mint düğmesi, dönen özellik önizlemesi).
   - **Mint sonrası:** zarf açılma / mühür kırılma (açılmadıysa mühürlü pasaport) animasyonu; OpenSea / Magic Eden / Tensor bağlantıları.
7. **Sıralama (gazete):** Sezon / Bugün / Tüm zamanlar; havuz; ödül payları; talep.
8. **Profil:** ad, seviye, istatistikler, skin seçimi (temel skinler + sahip olunan Pass'ler).
9. **Ayarlar:** dil, ses, tema, mini harita, performans.
10. **Doküman** (`/docs`): bölüm 9.
11. **İzleyici modu.**

### 7.3 Oyun dünyası çizimi (risograf)
- **Zemin:** kâğıt + açık mavi milimetrik kareler + gren; harita kenarı kesik çizgi.
- **Coin karakterleri:**
  - iki katman baskı: gövde mürekkebi ve hafif kaymış ikinci renk, `multiply`;
  - mürekkep kontur, halftone gölge;
  - gözler bakış yönünü izler; ifadeler: aç, korkmuş, gururlu, uykulu.
  - Jöle esnemesi korunur.
- **Yem:** riso konfeti (nokta, yıldız, üçgen). **Kaktüs:** yeşil riso dikenli. **Ganimet:** hardal coin + "$" damgası + parıltı.
- **Parçacıklar:** mürekkep sıçraması, kâğıt kırıntısı. Yeme anında "çıt" damga efekti.
- **Performans:** sprite önbelleği; 120+ varlıkta 60 fps hedefi (orta seviye dizüstü).

### 7.4 Hareket (motion) kuralları
- **Süreler:** mikro etkileşim 120–180 ms; ekran geçişleri 260–360 ms (yay, aşmalı); damga 420 ms (1.4 → 1 ölçek + 2–3° dönüş + mürekkep yayılması).
- **Kalıplar:**
  - butonlar baskı gibi 3–4 px çöker;
  - rakamlar sayarak değişir (makine sayacı);
  - listeler 30 ms aralıklarla belirir;
  - hover'da pembe katman hafifçe kayar.
- `prefers-reduced-motion`: döngüler durur, geçişler kısalır.
- **Kütüphane:** `motion` (React için yay animasyonları); döngüler CSS ile.

### 7.5 Diğer
- TR/EN; dokunma hedefleri ≥ 44 px; kontrast 4.5:1 (büyük yazı 3:1).
- Klavye ile tam gezinme; ikon düğmelerinde `aria-label`.
- Cüzdan: Wallet Standard (Phantom, Solflare, Backpack…), `confirmSignature` ile yoklamalı onay.
- Token bakiyesi okuma; arenaya girişte gerekirse ilişkili token hesabı oluşturma.

---

## 8. NFT üretim aracı (`packages/pass-art` + `pnpm pass:*`)
- `traits(seed, n)` ve `drawPass(ctx, traits, size)`: paylaşılan kod; oyun da aynısını kullanır.
- `pnpm pass:preview --seed X --count 60`: kontrol sayfası (HTML ızgara + nadirlik dağılımı).
- `pnpm pass:generate --seed X --out dir`: tüm görseller (1024×1024 PNG), metadata JSON (ad, açıklama, görsel, özellikler, nadirlik), koleksiyon görseli ve banner, `rarity-report.md`.
- `pnpm admin create-collection`, `set-pass-collection`, `set-pass-seed-hash`, `open-mint`, `reveal`: dokümandaki sırayla çalıştırılır.

---

## 9. Dokümantasyon
- **Oyuncu dokümanı** (sitede `/docs`, TR/EN, Kâğıt Bilet stilinde):
  - Nasıl oynanır; Odalar ve giriş bedelleri; Değer akışı ve ganimet; Cash-out ve kesinti;
  - Slana Pass (avantajlar + oyun içi güç açıklaması); Mint ve açılış; Sezonlar ve ödüller;
  - Adil oyun ve şeffaflık (zincirde ne var, sunucuya ne güveniyorsunuz); Cüzdan güvenliği; SSS.
- **Repo:**
  - `README.md` (yeni ad, ekran görüntüleri);
  - `docs/DEPLOY.md` (token + koleksiyon + mint + arena kurulumu, mainnet maliyetleri);
  - `docs/OPERATIONS.md` (sezon, reveal, hazine, acil durum);
  - `docs/ARCHITECTURE.md` (para akışı diyagramı, değişmezler);
  - `docs/PASS-ART.md` (koleksiyon üretimi ve barındırma).

---

## 10. Test stratejisi

| Katman | Kapsam |
|---|---|
| Program | 5.4 listesi; her para yolu için olumlu ve olumsuz testler |
| SDK | PDA'lar, talimat oluşturucular (Core CPI hesap sıralaması dahil), görünüm çözümleme, kesinti matematiği (programla birebir) |
| Shared | `traits(seed,n)` determinizmi ve tekrarsızlık, kodek (Loot türü), biçimlendirme |
| Sunucu | korunum simülasyonu (ganimet dahil), botların değer taşımaması, örnek açma, Hızlı Oyna, ligler, Pass gücünün uygulanması, günlük kurtarma, WebSocket entegrasyonu (sahte zincirle) |
| Web | tip kontrolü + derleme; Playwright ile ekran görüntüsü turu (masaüstü + mobil, TR/EN, açık/koyu) |
| Uçtan uca | localnet: test token mint'i (Token-2022) + Core klonu ya da sahte varlık → mint → bilet → oyun → cash-out → settle → sezon |

---

## 11. Aşamalar
1. **Yeniden adlandırma ve temel:** Slana, $SLANA, paket adları `@slana/*`, program `slana`. Testler yeşil kalır.
2. **Program v2** + LiteSVM testleri.
3. **SDK v2** + admin CLI (koleksiyon, mint, reveal, arena, hazine).
4. **Sunucu v2:** odalar, botlar, ganimet, eşleştirme, Pass gücü, NFT doğrulama, metadata uç noktaları.
5. **Paylaşılan Pass çizimi + üretim aracı.**
6. **Web v2:** tasarım sistemi, tüm ekranlar, riso çizim, animasyonlar, mint sayfası, doküman sayfası.
7. **Dokümanlar + localnet uçtan uca test + ekran görüntüleri**, sonra push.

---

## 12. Riskler ve açık konular
- **Hukuk:**
  - Gerçek değerli tokenle oynanan beceri oyunu birçok ülkede kumar düzenlemesine girer.
  - Paralı odada NFT'ye oyun içi güç vermek "satın alınan avantaj" sayılabilir. Bu güç açıkça gösterilir ve ayardan kapatılabilir.
  - Sezon ödülleri ve yakım "getiri vaadi" gibi pazarlanmamalı.
- **Denetim:** program ciddi şekilde değişti (token, Core CPI, kilitler); mainnet öncesi bağımsız denetim gerekir.
- **Program boyutu:** `anchor-spl` ve Token-2022 uzantı okuma programı büyütür. Tahmini kira ≈ ◎4–6 (geri alınabilir); kesin değer derlemeden sonra dokümana yazılır.
- **Core programı localnet'te:** mainnet'ten klonlama için ağ erişimi gerekir. Yoksa sahte varlıklarla test edilir, `mint_pass` için birim test yazılır ve gerçek mint devnet'te denenir.
- **Takımlaşma (iki cüzdanla birbirini besleme):** bu sürümde önlem yok. Gelecekte davranış analizi eklenebilir.
- **Ücretsiz mint ve botlar:** cüzdan başı sınır ve isteğe bağlı `$SLANA` tutma şartı var. Tam sybil koruması yok.
- **Metadata'nın sunucuda barındırılması:** sunucu kapanırsa pazar yerlerindeki görseller kaybolur. Bunu önlemek için Arweave'e taşıma rehberi verilir.

## 13. Kapsam dışı
Bölge sunucuları, turnuvalar, sohbet moderasyon paneli, mobil uygulama mağazası sürümleri, takımlaşma tespiti, çoklu token desteği.
