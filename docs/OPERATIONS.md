# Slana: operasyon rehberi

Kurulumdan sonraki işler: sezon döngüsü, Pass açılışı, hazine, durdurma, arena kapatma, anahtar değişimi ve journal
yedeği. Kurulum: [DEPLOY.md](DEPLOY.md). Para akışı ve güven modeli: [ARCHITECTURE.md](ARCHITECTURE.md).

*English: day-to-day operations (season cycle, Pass reveal, treasury, pause, arena shutdown, key rotation, journal
backup). Every command below exists in `pnpm admin help`.*

Komutlar `--url`, `--keypair` (varsayılan `~/.config/solana/id.json`, yani yönetici) ve `--program` alır; bkz.
[DEPLOY.md](DEPLOY.md). Her işlemden önce ve sonra:

```bash
pnpm admin status
```

`status` şunları yazar: admin ve sunucu anahtarı (SOL bakiyesiyle), token mint'i ve arzı, kesinti ve bölüşüm, depozito,
güncel sezon, `paused`, toplamlar, hazine ve sezon kasası bakiyeleri, arenalar (açık bilet / sınır, kasa, açık mı),
sezonun ilk 10'u ve havuzu, bir önceki sezonun dondurulan havuzu, talep edilmeyen kısmı ve talep maskesi, Pass
koleksiyonu, base URI, basılan / arz, arz kilidi, mint durumu, tohum özeti, entropi (hedef slot ya da yakalanan hash) ve açılış (yönetici
tohumu ve özelliklerin türediği son tohum).

## İzleme

- `GET /api/health`: `ok`, çalışma süresi, çevrimiçi oyuncu, oda sayısı (Docker sağlık kontrolü bunu kullanır).
- `GET /api/rooms`: odalar, örnekler, insan ve bot sayıları, yerdeki ganimet.
- `GET /api/pending?wallet=<adres>`: bir cüzdana borçlu ödemeler; `needsTokenAccount: true` = oyuncunun token hesabı yok.
- Sunucu günlüğünde `!!!` ile başlayan satırlar müdahale ister (ör. okunamayan journal, kasası yetmeyen arena). Sunucu
  anahtarı ◎0,05'in altına düşünce uyarı yazar.

## Sezon döngüsü

Sezonun zincirde sabit bir bitiş zamanı **yoktur**; sezonu yönetici bitirir. Takvimi (ör. 30 gün) oyunculara siz
duyurursunuz.

1. **Sezon sürerken** puan yalnızca Pass'li biletlerden gelir; havuz kesintilerin sezon payından (varsayılan %30) ve
   süpürülen arenalardan dolar. `status` havuzu ve ilk 10'u gösterir.
2. **Bitirin:**
   ```bash
   pnpm admin end-season
   ```
   Güncel sezonun havuzu `prize_pool` olarak dondurulur ve hemen yeni sezon başlar. Yeni Season hesabının kirasını
   (≈◎0,0099) yönetici öder.
3. **Talep:** ilk 10, Sıralama sayfasından ödülünü kendisi talep eder: dondurulan havuzun %30 / %20 / %14 / %10 / %8 /
   %6 / %4,5 / %3 / %2,5 / %2'si. Süre sezon bittikten sonra 30 gündür (`CLAIM_WINDOW_SECS`).
4. **Devir:** 30 gün dolduktan sonra talep edilmeyenleri (yuvarlama artıkları ve boş sıralar dahil) aktif sezona aktarın:
   ```bash
   pnpm admin rollover --season <N>
   ```
   Program süre dolmadan devri reddeder (`ClaimWindowOpen`).

## Pass açılışı (reveal)

Açılış commit–reveal'in ikinci yarısıdır ve sırası önemlidir (karar R23):

- Mint **bittiğinde** (`close-mint` ya da son Pass'in basılması) mint **bir daha açılamaz**; henüz hiçbir entropi hedefi
  yoktur.
- `reveal` tohumu zincirde **herkese açık** yayınlar (program `sha256(tohum) == pass_seed_hash` şartını denetler) ve
  **ancak ondan sonra** hedef slotu kaydeder: o anki slot + `ENTROPY_DELAY_SLOTS` (150 slot ≈ 1 dakika).
- Hedef geçince herkesin gönderebildiği `capture_pass_entropy`, hedefte ya da ondan sonraki ilk blokta oluşan slotun
  hash'ini SlotHashes sysvar'ından okuyup `pass_entropy` olarak saklar, son tohumu
  `pass_final_seed = sha256(tohum ‖ pass_entropy)` hesaplar ve açılışı tamamlar. Bütün Pass'lerin özellikleri
  `passTraits(pass_final_seed, n, pass_supply)` ile herkesçe hesaplanabilir.

Tohum hedef slottan önce açık olduğu için sonucu herkes aynı anda öğrenir; yöneticinin bilgi avantajı yoktur. Kalan risk
(dürüstçe): sonucu beğenmeyen biri pencerenin (≈512 slot) yakalama olmadan geçmesini umabilir, bu hedefi yeni bir gelecek
slota taşır. Ama herkes (Pass sahipleri dahil) her an yakalayabilir; oyun sunucusu ve web'deki Pass sayfası da yakalar,
bu yüzden zamanlamayı tek bir taraf kontrol edemez.

1. Mint'i bitirin (arz bittiyse program zaten bitirmiştir):
   ```bash
   pnpm admin close-mint
   ```
   Hiç Pass basılmadıysa komut yalnızca bayrağı kapatır (mint yeniden açılabilir). Basım başladıysa
   `update-config --mint-open false` reddedilir (`UseCloseMint`): mint'i yalnızca `close-mint` bitirir.
2. Tohum dosyasının özetini zincirdekiyle karşılaştırın:
   ```bash
   pnpm admin pass-seed                       # keys/pass-seed.json'un sha256'sını yazar
   pnpm admin status                          # "seed hash" satırı
   ```
3. Tohumu açıklayın (hedef slotu da bu ayarlar):
   ```bash
   pnpm admin reveal [--seed-file keys/pass-seed.json]
   ```
   Program mint'in bitmiş olmasını ve `sha256(seed) == pass_seed_hash` şartını denetler; tohumu açık saklar ve hedef
   slotu yazar. Komut hedef slotu yazdırır. Pass sayfası "Açılışın tamamlanması bekleniyor" durumunu gösterir.
4. Açılışı tamamlayın: oyun sunucusu hedef slot geçince `capture_pass_entropy`'yi kendisi gönderir (yalnızca ağ
   ücretini öder, başarısız olursa 30 sn'de bir yeniden dener; günlükte `chain: Pass entropy captured … final seed …`).
   Web'deki Pass sayfasında bağlı her cüzdan "Açılışı tamamla" düğmesine basabilir. Elle:
   ```bash
   pnpm admin capture-entropy                 # herhangi bir cüzdan gönderebilir
   pnpm admin status                          # entropy, final seed
   ```
5. Oyun sunucusu açılışı zincirden okur (yapılandırma önbelleği 30 sn) ve `/pass/<n>.json` ile `/pass/<n>.png` mühürlü
   içerik yerine özellikleri döndürür. Önbellek süreleri: JSON mühürlüyken 60 sn, açılıştan sonra 1 saat (`PUBLIC_URL`
   boşsa JSON hiç önbelleğe alınmaz); PNG mühürlüyken 300 sn, açılıştan sonra 1 gün. Pazar yerlerinden metadata
   yenilemesi isteyin.
6. İsteğe bağlı: koleksiyonu çevrimdışı üretip arşivleyin ya da Arweave'e yükleyin ([PASS-ART.md](PASS-ART.md)).

> **Arz sabittir.** Özellikler `pass_supply`'a bağlıdır (1/1 yerleşimi ve tekrar ayıklama bütün koleksiyon üzerinden
> yapılır). Program arzı mint bir kez açıldıktan sonra değiştirmez (`SupplyLocked`); CLI de `update-config --supply` ve
> `open-mint --supply`'ı o andan sonra reddeder. Arzı `open-mint`'ten önce ayarlayın. Mint'i erken bitirmek sorun değildir:
> arz aynı kalır, basılmayan numaralar hiç basılmaz.

## Hazine

Kesintilerin hazine payı (varsayılan %50) hazine kasasında birikir (`status` → `vaults treasury`).

```bash
pnpm admin withdraw-treasury --amount <token> --to <sahip cüzdan>
```

`--to` bir **cüzdan adresidir** (token hesabı değil): ödeme bu cüzdanın ilişkili token hesabına gider; hesap yoksa aynı
işlemde oluşturulur (kirasını yönetici öder). Tutar tam token olarak yazılır ve kasadan fazla olamaz.

## Durdurma ve acil durum

| Ne | Komut | Etkisi |
|---|---|---|
| Yeni biletleri durdur | `pnpm admin update-config --paused true` | `join_arena` reddedilir; **ödemeler ve iadeler sürer**. Geri almak: `--paused false` |
| Tek arenayı kapat | `pnpm admin update-arena --id N --enabled false` | o arenaya bilet kesilemez; açık biletler oynanıp kapanır |
| Arenaları sunucuda kapat | sunucu ortamında `STAKE_ENABLED=false`, yeniden başlat | arenalar lobiden kalkar; ödeme kuyruğu çalışmaya devam eder |
| Kesintiyi ya da depozitoyu değiştir | `pnpm admin update-config --fee-bps N --pass-fee-bps N --split T/S/B --settle-fee-lamports N` | kesinti oranı ve depozito bundan sonra **kesilen biletlere** uygulanır (açık bilet, kesildiği andaki oranı korur: `Session.fee_bps`); bölüşüm sonraki ödemelerde geçerli; kesinti en fazla 1000 (%10) |
| Pass gücünü kapat | sunucuda `PASS_START_MASS_MUL=1` ve `PASS_CASHOUT_MS=3000`, yeniden başlat | Pass'li biletler normal başlar ve çıkar |

Sunucu `SIGTERM`/`SIGINT` alınca arenadaki oyuncuları cash-out'a alır ve durumu kaydeder; yeniden başlatmalar için bunu
kullanın (Docker `stop` SIGTERM gönderir).

### Arenayı kalıcı kapatma (sweep)

1. `pnpm admin update-arena --id N --enabled false`
2. Açık biletlerin kapanmasını bekleyin: `status` → `open 0/…`. Sunucu biletleri en geç 6 saatte otomatik cash-out yapar;
   kapanmayanlar oyuncu tarafından 24 saat sonra iade alınabilir.
3. `/api/rooms`'ta o arenanın odalarında ganimet kalmadığından ve `GET /api/pending` / sunucu günlüğünde o arenaya ait
   bekleyen ödeme olmadığından emin olun (CLI sunucunun journal'ını göremez).
4. ```bash
   pnpm admin sweep --id N --force
   ```
   `--force` olmadan komut yalnızca uyarıyı yazar ve durur. Kasanın tamamı güncel sezonun havuzuna aktarılır (oyunculara
   döner). Program yalnızca kapalı ve açık bileti olmayan arenayı süpürür. Süpürülmüş bir arenayı yeniden açmayın:
   sunucunun journal'ında kalmış ganimet artık kasada değildir. Sunucu da bunu denetler: bir arenayı bağlarken kasası
   journal'daki borcu (ganimet + bekleyen ödemeler + canlı biletler) karşılamıyorsa arenayı kapalı tutar ve günlüğe
   `!!! arena #N KEPT DISABLED` yazar.

## Sunucu anahtarını değiştirme

Ödemeleri yalnızca `Config.server_authority` imzalayabilir; journal'daki bekleyen ödemeler yeni anahtarla gönderilir.

1. Yeni anahtar üretin ve fonlayın:
   ```bash
   solana-keygen new -o keys/server-2.json --no-bip39-passphrase
   solana transfer $(solana-keygen pubkey keys/server-2.json) 0.5 --allow-unfunded-recipient
   ```
2. Sunucuyu durdurun (SIGTERM: oyuncular cash-out'a alınır, ödemeler journal'da kalır).
3. Zincirde değiştirin:
   ```bash
   pnpm admin update-config --server $(solana-keygen pubkey keys/server-2.json)
   ```
4. Sunucuyu aynı `DATA_DIR` ile `SERVER_KEYPAIR=keys/server-2.json` olarak başlatın; bekleyen ödemeler yeni anahtarla
   gönderilir. Eski anahtar uyuşmadığı sürece sunucu "server key is not the program server authority" diyerek bekler ve
   yeniden dener.
5. Eski anahtardaki SOL'ü çekin ve anahtarı imha edin.

Anahtar **sızdıysa** önce `pnpm admin update-config --paused true`, sonra hemen 3. adım: eski anahtar, değiştirilene kadar
açık biletleri kasayı aşmayan herhangi bir tutarla kapatabilir. Yönetici anahtarı için `update-config --admin <yeni>`;
upgrade authority için `solana program set-upgrade-authority`.

## Journal yedeği

`DATA_DIR` içeriği:

| Dosya | İçerik | Kaybolursa |
|---|---|---|
| `journal.json` | bekleyen ödemeler, arenalardaki canlı değerler, odalardaki ganimet | **borçlu ödemeler kuyruktan düşer** (oyuncular yalnızca 24 saat sonra giriş bedelini iade alabilir) |
| `leaderboards.json` | sunucunun Bugün / Tüm zamanlar tabloları | yalnızca görünüm |
| `pass/` | Pass PNG önbelleği | yeniden üretilir |
| `*.dev-fake.json` | `DEV_FAKE_CHAIN` dosyaları | gerçek parayla ilgisi yok |

- Journal her ödeme kuyruğa girdiğinde ve değerler değiştikçe en fazla saniyede bir **geçici dosyaya yazılıp yeniden
  adlandırılır**: diskteki dosya her an tam bir anlık görüntüdür. Düzenli olarak kopyalayın (ör. dakikada bir, kalıcı
  bir volume'dan) ve yedekleri şifreli saklayın (cüzdan adresleri içerir).
- Okunamayan bir journal `journal.json.corrupt-<zaman>` olarak kenara alınır ve sunucu boş başlar; günlükte `!!!` uyarısı
  çıkar. Sunucuyu durdurup son sağlam yedeği geri koyun.
- Geri yükleme: sunucuyu durdurun, dosyayı `DATA_DIR/journal.json` olarak koyun, başlatın. Zaten ödenmiş ya da iade
  edilmiş biletlerin kayıtları kendiliğinden düşer (oturum kapalı ya da `SessionMismatch`); eski görüntüdeki canlı
  biletler otomatik cash-out'a alınır. Eski bir yedek, o tarihten sonra toplanmış ganimeti geri getirebilir: mümkün olan
  en yeni yedeği kullanın.
- Aynı `DATA_DIR`'ı ya da aynı `SERVER_KEYPAIR`'ı iki sunucuda birden kullanmayın.

## Program güncellemesi

```bash
anchor build && pnpm -F @slana/sdk sync-idl && cargo test -p slana
solana program deploy target/deploy/slana.so --program-id target/deploy/slana-keypair.json   # upgrade authority ile
```

Hesap düzenini (state.rs) geriye uyumlu tutun; yeni `.so` daha büyükse önce `solana program extend <PROGRAM_ID> <bayt>`.
Mainnet'te güncellemeyi multisig ile yapın ve öncesinde devnet'te deneyin.
