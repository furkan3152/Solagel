# Slana: kurulum ve dağıtım rehberi (devnet → mainnet)

Bu rehber Solana programını derleyip dağıtmayı, $SLANA token'ını bağlamayı, Slana Pass koleksiyonunu ve mint'i kurmayı,
arenaları açmayı ve oyun sunucusunu yayına almayı anlatır. Günlük işler (sezon, açılış, hazine, durdurma, anahtar
değişimi, yedek) için: [OPERATIONS.md](OPERATIONS.md). Mimari ve güven modeli: [ARCHITECTURE.md](ARCHITECTURE.md).
**Önce devnet'te deneyin.**

*English: step-by-step deployment of the program, token, Pass collection and mint, arenas and game server, with mainnet
costs. Commands are quoted from `pnpm admin help` and `apps/server/.env.example`.*

> **Yasal ve güvenlik uyarısı.** Slana gerçek değerli bir tokenle oynanan bir oyundur ve bulunduğunuz ülkede lisans
> gerektirebilir. Pass'in oyun içi gücü "satın alınan avantaj" sayılabilir. Akıllı kontrat **bağımsız bir denetimden
> geçmemiştir**: mainnet'te gerçek parayla açmadan önce denetim yaptırın, küçük bedellerle başlayın. Arenaları zincire
> dokunmadan kapatmak için sunucuda `STAKE_ENABLED=false` kullanılabilir.

Bütün yönetici komutları `pnpm admin <komut>` ile çalışır; tam liste `pnpm admin help`. Ortak seçenekler:

| Seçenek | Varsayılan |
|---|---|
| `--url <rpc>` | `$SOLANA_RPC_URL` ya da `http://127.0.0.1:8899` |
| `--keypair <path>` | `~/.config/solana/id.json` (imzalayan ve ücreti ödeyen) |
| `--program <id>` | `$PROGRAM_ID` ya da SDK'daki IDL adresi |
| `--cluster <name>` | `--url`'den çıkarılır (gezgin bağlantıları için) |
| `--verbose` | hatalarda işlem günlüklerini yazar |

Token tutarları (`--entry`, `--amount`, `--min-tokens`) **tam token** olarak yazılır (`.` ondalık), mint'in ondalık
sayısıyla ölçeklenir. Aşağıdaki örneklerde `--url` kısalık için yazılmadı: `export SOLANA_RPC_URL=...` yapın ya da her
komuta ekleyin.

---

## 0. Gerekenler

| Araç | Sürüm | Not |
|---|---|---|
| Node.js | 22+ | `corepack enable` (pnpm 10.28.0, `package.json` `packageManager`) |
| Rust | 1.97.1 | `rust-toolchain.toml` seçer |
| Solana (Agave) CLI | 4.3.x | `solana`, `solana-keygen`, `cargo-build-sbf` |
| Anchor CLI | 1.2.1 | `npm i -g @anchor-lang/cli@1.2.1` |

```bash
pnpm install
```

## 1. Üçüncü taraf programlar

Program testleri (LiteSVM) Metaplex Core programını yükler. Bir kez indirin:

```bash
scripts/fetch-programs.sh                    # mainnet'ten Core → target/programs/mpl_core.so
MAINNET_RPC=<url> scripts/fetch-programs.sh  # başka bir RPC ile
```

Betik `solana program dump` ile `CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d` programını indirir; dosya varsa atlar.
`target/` git'e girmez: üçüncü taraf `.so` dosyaları **asla commit edilmez**. Devnet ve mainnet'te Core zaten dağıtılmıştır.

## 2. Program anahtarı ve derleme

Repodaki `declare_id!` geliştirme sırasında üretilmiş bir adrestir. **Kendi program anahtarınızı üretin**:

```bash
solana-keygen new -o target/deploy/slana-keypair.json   # bu dosyayı güvenle yedekleyin
anchor keys sync                                        # declare_id! ve Anchor.toml güncellenir
anchor build                                            # target/deploy/slana.so + IDL
pnpm -F @slana/sdk sync-idl                             # IDL'i SDK'ya kopyalar (istemci, sunucu ve admin bunu kullanır)
cargo test -p slana                                     # LiteSVM testleri (adım 1'deki Core .so gerekir)
```

## 3. Anahtarlar

`keys/` klasörü git'e girmez (`.gitignore`: `keys/`, `*.keypair.json`, `pass-seed*.json`, `.env`).

| Anahtar | Ne yapar | Öneri |
|---|---|---|
| Yönetici (`~/.config/solana/id.json`) | programın **upgrade authority**'si; `init` yalnızca onunla imzalanır; Config `admin`'i olur | mainnet'te sonra multisig'e (Squads) devredin |
| Sunucu (`keys/server.json`) | `settle_session` imzalar (`Config.server_authority`) | yalnızca sunucuda; biraz SOL |
| Hazine sahibi | `withdraw-treasury --to` ve koleksiyon telifinin alıcısı | multisig |
| Pass tohumu (`keys/pass-seed.json`) | commit–reveal'in gizli tohumu | **gizli ve yedekli**; kaybolursa açılış yapılamaz |

```bash
mkdir -p keys
solana-keygen new -o keys/server.json --no-bip39-passphrase
```

## 4. Programı dağıtın (devnet)

```bash
solana config set --url devnet
solana airdrop 5                                  # gerekirse https://faucet.solana.com
anchor deploy --provider.cluster devnet           # ya da: solana program deploy target/deploy/slana.so --program-id target/deploy/slana-keypair.json
solana transfer $(solana-keygen pubkey keys/server.json) 0.5 --allow-unfunded-recipient
```

## 5. Token

Program, mint adresini `init` sırasında **bir kez** Config'e yazar; sonradan değiştirilemez. Şartlar (programda ve
`pnpm admin init`'te kontrol edilir):

- SPL Token ya da Token-2022 mint'i;
- **dondurma yetkisi olmamalı** (`freeze authority` varsa reddedilir);
- Token-2022 ise şu uzantılar reddedilir: TransferFeeConfig, TransferHook, PermanentDelegate, NonTransferable,
  DefaultAccountState, ConfidentialTransferMint, ConfidentialTransferFeeConfig, Pausable, MintCloseAuthority,
  ConfidentialMintBurn (meta veri uzantılarına izin verilir);
- arz en fazla 2^53 − 1 taban birimi olmalı (admin CLI daha büyüğünü reddeder; sunucu arenaları kapatır).

Mainnet'te $SLANA mint adresini kullanın. Devnet denemesi için dondurma yetkisi olmayan bir test mint'i oluşturun
(ör. `spl-token create-token --decimals 6`) ve kendinize biraz basın.

## 6. Programı başlatın: `init --mint`

```bash
pnpm admin init --mint <MINT> --server $(solana-keygen pubkey keys/server.json)
pnpm admin status
```

`init`; Config'i, hazine ve sezon kasalarını ve sezon 1'i oluşturur. Varsayılanlar (`pnpm admin help`):

| Seçenek | Varsayılan | Anlamı |
|---|---|---|
| `--fee-bps` | 500 | kârdan kesinti %5 (üst sınır 1000 = %10) |
| `--pass-fee-bps` | 200 | Pass'li bilette %2 (≤ `--fee-bps`) |
| `--split` | 5000/3000/2000 | kesintinin hazine / sezon / yakım payı (toplam 10000) |
| `--settle-fee-lamports` | 20000 | bilet başına ödeme depozitosu (≤ 1 000 000) |

İmzalayan, programın upgrade authority'si olmalıdır; değilse `init` reddedilir. Pass varsayılanları: arz 3.333, cüzdan
başı 1, minimum token şartı yok.

## 7. Slana Pass: tohum ve koleksiyon

Sıra önemlidir: tohum özeti **ilk mint'ten önce** zincire yazılmalı, koleksiyon bir kez ayarlanır.

```bash
pnpm admin pass-seed --new                 # keys/pass-seed.json: 32 rastgele bayt, sha256'sını yazar
pnpm admin set-seed-hash                   # sha256(seed) zincire (ilk mint'ten önce)
pnpm admin create-collection --name "Slana Pass" --uri https://<alan-adı>/pass/collection.json \
  --royalty-bps 500 --royalty-to <hazine sahibi>
pnpm admin set-pass-collection --collection <C>   # create-collection çıktısındaki adres; bir kez
```

- `create-collection` Core koleksiyonunu oluşturur; güncelleme yetkilisi programın `["pass_authority"]` PDA'sıdır, yani
  Pass'leri yalnızca program basabilir. Royalties eklentisi `--royalty-to` adresine `--royalty-bps` telif yazar.
- `pass-seed --new` var olan dosyanın üstüne yazmaz (`--force` gerekir; eski tohum kaybolur). Tohumu **yedekleyin** ve
  **commit etmeyin**.
- Tohum tek başına özellikleri belirlemez: mint bittiğinde (`close-mint` ya da son Pass) program ~150 slot sonrası için
  bir hedef slot kaydeder; o slotun hash'i (oyun sunucusunun otomatik gönderdiği `capture_pass_entropy` ile) entropi olur
  ve özellikler `passTraits(sha256(tohum ‖ entropi), n, arz)` ile hesaplanır. Böylece yönetici de mint
  sürerken hangi numaranın nadir olacağını bilemez.
- Arzı (`update-config --supply N`, varsayılan 3333) **mint'i açmadan önce** ayarlayın: mint bir kez açılınca program
  arzı kilitler (`SupplyLocked`).
- Koleksiyon görselleri ve metadata varsayılan olarak oyun sunucusundan servis edilir (`/pass/...`); `<alan-adı>`
  sunucunun `PUBLIC_URL`'üdür. Arweave ve görsel üretimi: [PASS-ART.md](PASS-ART.md).

## 8. Arenalar

```bash
pnpm admin create-arena --defaults         # varsayılan dört arena (var olanları atlar)
pnpm admin create-arena --id 5 --entry 5000 --max 300 [--pass]
pnpm admin update-arena --id 2 --enabled false
```

Varsayılan arenalar (`packages/shared/src/arenas.ts`, `DEFAULT_ARENAS`):

| id | Ad | Bedel | Pass | Aynı anda açık bilet |
|---|---|---|---|---|
| 1 | Kuruş Gölü (Penny Pond) | 1.000 $SLANA | gerekmez | 300 |
| 2 | Gümüş Dere (Silver Stream) | 10.000 $SLANA | gerekmez | 300 |
| 3 | Altın Göl (Golden Lake) | 50.000 $SLANA | gerekli | 300 |
| 4 | Balina Koyu (Whale Bay) | 250.000 $SLANA | gerekli | 300 |

`--max` 2 ile 2000 arasındadır. Bir arenanın bedeli ve Pass şartı, açık bileti varken değiştirilemez (program reddeder).
Sunucu arena listesini zincirden 30 sn'de bir okur; yeni arenalar lobiye kendiliğinden gelir.

## 9. Oyun sunucusu

Örnek dosya: `apps/server/.env.example`. Sunucu `.env` dosyasını **kendisi okumaz**; değişkenleri ortamdan verin
(Docker: `--env-file`, systemd: `EnvironmentFile=`, elle: `set -a; . apps/server/.env; set +a`).

Zincir için gerekenler: `PROGRAM_ID`, `SOLANA_RPC_URL`, `SERVER_KEYPAIR`. Biri eksikse sunucu zincirsiz (yalnızca
antrenman) çalışır.

| Değişken | Varsayılan (kod) | Not |
|---|---|---|
| `PORT` / `HOST` | `8787` / `0.0.0.0` | |
| `DATA_DIR` | `data` | journal (borçlu ödemeler!), tablolar ve Pass görsel önbelleği. Kalıcı disk kullanın |
| `AUTH_SECRET` | rastgele | `openssl rand -hex 32`; yoksa her yeniden başlatmada oyuncular yeniden imzalar |
| `CORS_ORIGIN` | `*` | |
| `TRUST_PROXY` | `0` | ters vekil arkasında `1` (X-Forwarded-For / -Proto / -Host) |
| `PUBLIC_URL` | boş | sunucunun herkese açık adresi (`https://slana.example`); Pass metadata bağlantıları. **Üretimde ayarlayın** |
| `MARKET_URLS` | boş | JSON (`magicEden`, `tensor`, `opensea`); yalnızca https bağlantılar kullanılır |
| `MARKET_URL_MAGICEDEN` / `_TENSOR` / `_OPENSEA` | boş | `MARKET_URLS`'ten önceliklidir |
| `WEB_DIST` | boş | web derlemesini bu klasörden servis eder (tek origin) |
| `PRACTICE_CAPACITY` | `40` | antrenman odası başına insan |
| `PRIVATE_ROOM_CAPACITY` | `20` | |
| `ARENA_INSTANCE_CAP` | `50` | arena örneği başına insan; dolunca `arena-<id>-<n>` açılır |
| `BOT_TARGET` / `BOT_MIN` / `BOT_MAX` | `20` / `4` / `20` | antrenman botları |
| `ARENA_BOT_TARGET` / `ARENA_BOT_MIN` / `ARENA_BOT_MAX` | `24` / `2` / `16` | arena botları (değerleri 0) |
| `PRIVATE_BOT_TARGET` | `8` | |
| `PASS_START_MASS_MUL` | `1.15` | Pass gücü: başlangıç kütlesi çarpanı (en az 1; `1` = kapalı) |
| `PASS_CASHOUT_MS` | `2000` | Pass'li bilette cash-out süresi (normal süre 3000; `3000` = avantaj yok) |
| `MAX_CONNECTIONS` / `MAX_CONNECTIONS_PER_IP` | `600` / `8` | |
| `SOLANA_CLUSTER` | `localnet` | `localnet`, `devnet` ya da `mainnet-beta` |
| `SOLANA_RPC_URL` | boş | sunucunun RPC'si (API anahtarı içerebilir; mainnet'te ücretli RPC önerilir) |
| `SOLANA_WS_URL` | boş | isteğe bağlı websocket RPC (yalnızca `config.ts`'te) |
| `PUBLIC_RPC_URL` | boş | tarayıcılara duyurulan RPC; **sır içermemeli** |
| `PROGRAM_ID` | boş | dağıttığınız program |
| `SERVER_KEYPAIR` | boş | keypair dosya yolu ya da JSON dizisi; `Config.server_authority` ile aynı olmalı |
| `STAKE_ENABLED` | `true` | `false`: arenalar zincire dokunmadan kapanır (ödemeler sürer) |
| `STAKE_ARENA_IDS` | boş | yalnızca bu arena id'leri (virgülle); boş = zincirdeki tüm açık arenalar |
| `TOKEN_SYMBOL` | `$SLANA` | yalnızca görünüm. Bazı env yükleyiciler `$NAME`'i genişletir; örnek dosyada yorum satırıdır |
| `PRIORITY_FEE_MICROLAMPORTS` | `5000` | ödeme işlemlerinin öncelik ücreti |
| `DEV_FAKE_CHAIN` | boş | **yalnızca geliştirme**: `NODE_ENV=development` ister, `PROGRAM_ID`/`SERVER_KEYPAIR` varken başlamaz |

Sunucu anahtarı ödeme işlemlerinin ücretini öder; her bilet `settle_fee_lamports` depozitosuyla bunu geri öder. Sunucu
oyuncu token hesaplarının kirasını **hiç ödemez**: hesabı olmayan oyuncunun ödemesi bekler, 5 dakikada bir yeniden
denenir ve lobide "token hesabını oluştur" çağrısı görünür. Sunucu anahtarı 0,05 SOL'ün altına düşünce günlüğe uyarı
yazar.

Yerelde: `pnpm dev` (sunucu :8787 + web :5173; Vite `/ws` ve `/api`'yi sunucuya yönlendirir).

## 10. Docker

```bash
docker build -t slana .
docker run -p 8787:8787 -v slana-data:/data --env-file apps/server/.env slana
```

Tek konteyner = oyun sunucusu + web istemcisi (aynı origin). İmajda `NODE_ENV=production`, `DATA_DIR=/data`,
`WEB_DIST=/app/web`, `TRUST_PROXY=1` ayarlıdır; `/data` bir volume'dur (journal burada: **kalıcı olmalı**). Sağlık
kontrolü `GET /api/health`. Sunucu `/docs` gibi istemci yollarında `index.html` döner, yani oyuncu kılavuzu
`https://<alan-adı>/docs` adresinde açılır.

Web istemcisini ayrı barındırmak isterseniz derleme argümanları: `VITE_SERVER_URL` (oyun sunucusunun adresi) ve
`VITE_RPC_URL` (tarayıcının RPC'si). Statik barındırıcı da `/docs` için `index.html`'e düşmelidir (SPA fallback).
Pass metadata'sı her durumda oyun sunucusundan gelir (`PUBLIC_URL`).

## 11. Pass mint'ini açın

Önce sunucu `PUBLIC_URL` ile yayında olmalı: pazar yerleri `/pass/<n>.json` ve görselleri buradan çeker.

```bash
pnpm admin open-mint --base-uri https://<alan-adı>/pass/ [--start <unix>] [--supply N] [--per-wallet N] [--min-tokens X]
pnpm admin status                          # "mint OPEN", basılan / arz
```

- `--base-uri` `/` ile bitmeli ve en fazla 96 bayt olmalı. Program her Pass'e `<base-uri><n>.json` yazar ve **ilk
  mint'ten sonra base URI değiştirilemez**.
- `open-mint` koleksiyon ve tohum özeti ayarlanmadan çalışmaz; mint bittikten (`close-mint` ya da arzın tükenmesi) sonra
  yeniden açılamaz.
- Mint ücretsizdir: mint eden yalnızca Core varlığının ve cüzdan sayacının kirasını ve ağ ücretini öder.
- Pass özellikleri `passTraits(son tohum, n, arz)` ile hesaplanır; son tohum = `sha256(tohum ‖ entropi)`. Arz, mint ilk
  açıldığında kilitlenir: `open-mint --supply` yalnızca ilk açılışta işe yarar, sonra program da CLI de reddeder.

Mint'i bitirmek (`close-mint`, hedef slotu kaydeder), entropiyi yakalamak (`capture-entropy`) ve açılış (reveal) için:
[OPERATIONS.md](OPERATIONS.md#pass-açılışı-reveal).

## 12. Mainnet

1. Program anahtarı ve derlemeyi (adım 2) mainnet için yapın; devnet'teki tüm akışı (bilet → oyun → cash-out → ödeme →
   sezon) önce devnet'te tamamlayın.
2. `solana config set --url mainnet-beta` (ya da ücretli RPC), yönetici cüzdanına aşağıdaki maliyetler kadar SOL koyun.
3. `anchor deploy --provider.cluster mainnet` (ya da `solana program deploy ...`).
4. Adım 6–11'i mainnet RPC'si ile tekrarlayın. `SOLANA_CLUSTER=mainnet-beta`, ücretli bir `SOLANA_RPC_URL`, sırsız bir
   `PUBLIC_RPC_URL`.
5. Upgrade authority'yi ve `admin`'i multisig'e devredin (`solana program set-upgrade-authority`,
   `pnpm admin update-config --admin <multisig>`), ya da denetimden sonra programı değiştirilemez yapın.
6. Küçük bedellerle başlayın; `pnpm admin status` ve sunucu günlüklerini izleyin.

## 13. Mainnet maliyetleri

Kira = `(bayt + 128) × 6960` lamport (varsayılan kira: 3480 lamport/bayt-yıl × 2 yıl muafiyet). `solana rent <bayt>` bir
RPC'ye ihtiyaç duyar; aşağıdaki değerler bu formülle hesaplandı. Hesap boyutları programdaki `INIT_SPACE` değerleridir
(Config 506, Season 1289, Arena 74, PlayerProfile 135, Session 142, PassLock 73, MintCounter 10 bayt; SDK'daki
`ACCOUNT_BYTES` ve bir SDK testi bunları IDL'den yeniden hesaplar).

**Program dağıtımı.** `target/deploy/slana.so` = **672.176 bayt** (`anchor build`, bu commit'teki kaynakla).

| Hesap | Bayt | Kira |
|---|---|---|
| ProgramData (`.so` + 45) | 672.221 | 4.679.549.040 lamport ≈ **◎4,680** (program kapatılırsa geri alınır) |
| Program hesabı | 36 | 1.141.440 lamport ≈ ◎0,0011 |
| Dağıtım tamponu (`.so` + 37, geçici) | 672.213 | 4.679.493.360 lamport ≈ ◎4,679 (dağıtım bitince geri döner) |

Dağıtım sırasında cüzdanda yaklaşık **◎9,36 + işlem ücretleri** bulunmalı; ◎4,68 kalıcı olarak programda kalır.
`solana program deploy`'un `--max-len` varsayılanı ilk programın boyudur; daha büyük bir sürüm yüklemek için
`solana program extend` gerekir (ek bayt başına aynı kira).

**Kurulum (yönetici öder, tek seferlik).**

| İşlem | Hesaplar | Kira |
|---|---|---|
| `init` | Config (506) + Season 1 (1289) + hazine ve sezon kasası (token hesabı, SPL'de 165 bayt) | ≈ ◎0,0143 + 2 × ◎0,0020 ≈ ◎0,018 |
| `create-arena` (her biri) | Arena (74) + kasa (165) | 1.405.920 + 2.039.280 lamport ≈ ◎0,0034; 4 varsayılan arena ≈ ◎0,0138 |
| `end-season` (her sezon) | yeni Season (1289) | ≈ ◎0,0099 |
| `create-collection` | Core koleksiyonu + Royalties eklentisi (tek alıcı) | **tahmin**: ≈ 49 + ad + URI + ~69 eklenti baytı; `Slana Pass` ve 42 baytlık bir URI ile ≈ 170 bayt ≈ ◎0,0021 (bayt başına 6960 lamport; kesin tutar Core'un hesap düzenine bağlıdır, `solana rent <bayt>` ya da işlemden sonra hesabın bakiyesiyle doğrulayın) |

Token-2022 token hesapları uzantılar nedeniyle biraz daha büyüktür (ör. 170 bayt ≈ ◎0,0021).

**Sürekli.** Oyun sunucusunun barındırması ve ücretli RPC. Sunucu anahtarı ödeme işlemlerinin ücretini öder; her bilet
20.000 lamport depozitoyla bunu karşılar (taban ücret 5.000 lamport/imza + `PRIORITY_FEE_MICROLAMPORTS` × işlem
birimi). Anahtarda bir miktar SOL tampon tutun (sunucu ◎0,05 altında uyarır).

**Oyuncunun ödedikleri (bilgi için).** Oturum kirası 142 bayt ≈ ◎0,00188 ve Pass kilidi 73 bayt ≈ ◎0,0014 (bilet
kapanınca geri döner); profil 135 bayt ≈ ◎0,0018 ve token hesabı ≈ ◎0,0020 (oyuncuda kalır); depozito ◎0,00002;
Pass mint: Core varlığı (ör. `https://slana.example/pass/` ile ≈ 127 bayt ≈ ◎0,0018) + ilk mint'te sayaç (10 bayt
≈ ◎0,00096).
