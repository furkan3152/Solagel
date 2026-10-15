# Slana

**Solana üzerinde zincir üstü, coin temalı bir Agar.io.** Odalara $SLANA ile bilet kesilir, her odanın sabit bir giriş
bedeli vardır ve **yediğin oyuncunun tokenleri sana geçer**. Slana Pass (ücretsiz mint edilen bir NFT) Pass odalarını
açar, kesintiyi düşürür ve sezon ödüllerine hak kazandırır. Para kuralları zincirde, oyun yetkili bir sunucuda çalışır.

*An on-chain, coin-themed Agar.io on Solana: tickets in $SLANA, eat a player and take their tokens, a free-mint Slana Pass.
English summary below.*

> **Uyarı / Warning.** Gerçek değerli bir tokenle oynanan bir oyundur; bulunduğunuz ülkede lisans gerektirebilir.
> Akıllı kontrat **bağımsız bir denetimden geçmemiştir**. Real-money play may need a licence where you operate; the
> program has **not been audited**.

---

## Ekran görüntüleri

v2 ("Kâğıt Bilet" tasarımı) ekran görüntüleri localnet uçtan uca testiyle birlikte eklenecek (plan, Task 17).
`docs/images/` içindeki eski görseller v1 arayüzüne (SOL arenaları, skin mağazası) aittir ve burada kullanılmaz.

## Nasıl oynanır

- **Antrenman:** ücretsiz; cüzdan, token ve NFT gerekmez. Botlarla oynanır; ödül ve zincir kaydı yoktur. Çaylak ve Usta
  ligleri vardır.
- **Arenalar:** zincirde birer hesap. Bilet = sabit giriş bedeli, arenanın kasasına (program hesabı) gider. Oyunda değerin
  giriş bedeliyle başlar; birini yediğinde onun değerinin kütle payı sana geçer. Botların değeri 0'dır; bir bot oyuncu
  yerse değer haritaya **ganimet** olarak saçılır ve yalnızca gerçek oyuncular toplayabilir.
- **Cash-out:** `C` ile 3 sn (Pass'li bilette 2 sn) hayatta kal; sunucu ödemeyi zincire gönderir. **Kesinti yalnızca
  kârdan**: varsayılan %5, Pass ile %2; %50 hazine, %30 sezon havuzu, %20 yakım.
- **Slana Pass:** Metaplex Core NFT, ücretsiz mint (yalnızca kira ve ağ ücreti), arz 3.333, cüzdan başı 1, commit–reveal
  ile adil açılış. Avantajlar: Pass odaları, %2 kesinti, sezon puanı/ödülü ve **oyun içi güç** (+%15 başlangıç kütlesi,
  2 sn cash-out). Bu güç biletlerde ve kılavuzda açıkça yazar.
- **Sezonlar:** puan yalnızca Pass'li biletlerden; zincirde ilk 20 tablo, ilk 10 havuzu %30 / %20 / %14 / %10 / %8 /
  %6 / %4,5 / %3 / %2,5 / %2 paylaşır; talep süresi 30 gün.

Oyuncu kılavuzu oyunun içinde: **`/docs`** (ya da lobide **Kılavuz** sekmesi), TR ve EN. Varsayılan arenalar
(`pnpm admin create-arena --defaults`): Kuruş Gölü 1.000, Gümüş Dere 10.000, Altın Göl 50.000 (Pass), Balina Koyu
250.000 (Pass) $SLANA.

| Kontrol | Masaüstü | Telefon |
|---|---|---|
| Hareket | Fare | Joystick |
| Bölün | `Space` | Böl düğmesi |
| Kütle bırak | `W` (basılı tutulabilir) | Bahşiş düğmesi |
| Cash-out (arenada) | `C` | Cash-out düğmesi |
| Sohbet / çıkartma | `Enter` / `1`–`8` | Sohbet / çıkartma düğmeleri |
| İzlerken sıradaki oyuncu | `Q` | |

## Mimari

Gerçek zamanlı fizik (30 Hz) zincirde çalışamaz. **Hibrit** model: oyun döngüsü yetkili Node sunucusunda; para, bilet,
kesinti, Pass, sezon ve ödüller Solana programında. Ayrıntı, para akışı diyagramı ve değişmezler:
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

| Klasör | İçerik |
|---|---|
| `programs/slana` | Anchor 1.2.1 programı: token arenaları (SPL Token / Token-2022), oturumlar, kesinti/yakım, sezonlar, Slana Pass (Core CPI, commit–reveal) + LiteSVM testleri |
| `packages/shared` | Oyun kuralları, ikili protokol, arena verisi, token biçimlendirme |
| `packages/sdk` | TypeScript istemci (PDA'lar, talimatlar, hesap okuma, kesinti matematiği) + **admin CLI** (`pnpm admin`) |
| `packages/art` | Pass özellikleri `passTraits(finalSeed, n, supply)` (`finalSeed = sha256(tohum ‖ mint kapanış entropisi)`), risograf coin/Pass çizimi, `pnpm pass:*` üretim aracı |
| `apps/server` | Oyun sunucusu: odalar ve örnekler, botlar, ganimet, günlük (journal), ödeme kuyruğu, Pass metadata uç noktaları |
| `apps/web` | Oyun istemcisi: "Kâğıt Bilet" tasarım sistemi, lobi, bilet akışı, Pass ofisi, sıralama, oyuncu kılavuzu |

Dokümanlar: [tasarım dokümanı (v2)](docs/superpowers/specs/2026-10-14-slana-design.md) ·
[kurulum ve dağıtım](docs/DEPLOY.md) · [operasyon](docs/OPERATIONS.md) · [mimari](docs/ARCHITECTURE.md) ·
[Pass görselleri](docs/PASS-ART.md)

## Hızlı başlangıç (zincirsiz)

Node 22+ ve pnpm 10 gerekir.

```bash
corepack enable
pnpm install
pnpm dev          # oyun sunucusu :8787 + web :5173
```

**http://localhost:5173**: cüzdan gerekmez, antrenmanda botlarla hemen oynanır. `PROGRAM_ID`, `SOLANA_RPC_URL` ve
`SERVER_KEYPAIR` verilmezse sunucu zincirsiz (yalnızca antrenman) çalışır.

Arayüz geliştirmek için sahte zincir: `NODE_ENV=development DEV_FAKE_CHAIN=1 pnpm dev:server` her cüzdana bedava arena
biletleri ve açılmış bir Pass verir, ödemeleri taklit eder. Yalnızca geliştirme içindir; `PROGRAM_ID` ya da
`SERVER_KEYPAIR` tanımlıyken başlamaz.

## Zincir ile çalıştırma

Adım adım (program, token, Pass koleksiyonu, mint, arenalar, sunucu, Docker, mainnet maliyeti):
**[docs/DEPLOY.md](docs/DEPLOY.md)**. Günlük işler (sezon, açılış, hazine, durdurma, anahtar değişimi, yedek):
**[docs/OPERATIONS.md](docs/OPERATIONS.md)**. Bütün yönetici komutları: `pnpm admin help`.

> Not: `scripts/localnet.sh` ve `pnpm -F @slana/server e2e` henüz v2 token akışına güncellenmedi (betik v1 `init`
> parametrelerini kullanıyor). Güncellenene kadar devnet adımlarını izleyin.

```bash
docker build -t slana .
docker run -p 8787:8787 -v slana-data:/data --env-file apps/server/.env slana   # → http://localhost:8787
```

## Testler

```bash
pnpm -r typecheck
pnpm -r test                        # shared, sdk, art, server, web (Vitest)
pnpm -F @slana/web build
scripts/fetch-programs.sh           # Metaplex Core .so → target/programs (bir kez; repoya girmez)
anchor build && cargo test -p slana # program (LiteSVM)
```

Ek araçlar: `pnpm -F @slana/server sim` (bot dengesi), `pnpm -F @slana/web shot <url> <png>` (ekran görüntüsü),
`pnpm pass:preview` (Pass önizleme ızgarası).

## Güven modeli

- Giriş bedelleri arena kasalarında (program hesapları) durur; ödeme kasayı aşamaz, kesinti yalnızca kârdan alınır ve
  %10 ile sınırlıdır. 24 saat ödenmeyen bileti oyuncu kendisi iade alır.
- Oyunun sonucu (kim kimi yedi, cash-out anındaki değer, skor) **yetkili sunucuya güvenir**. Sunucu anahtarı yalnızca açık
  biletleri kapatabilir; hazineye, sezon kasasına ve ayarlara dokunamaz. Yönetici sunucu anahtarını değiştirebildiği için
  bu güven sonuçta yöneticiye güvendir.
- Pass'in oyun içi gücü sunucu ayarıdır (`PASS_START_MASS_MUL`, `PASS_CASHOUT_MS`) ve açıkça duyurulur.

---

## English summary

**Slana** is an on-chain, coin-themed Agar.io on Solana.

- **Practice** is free: no wallet, no token, bots only, Rookie and Pro leagues, nothing on-chain.
- **Arenas** are on-chain accounts with a fixed entry fee in **$SLANA**. Your in-game value starts at the entry fee;
  eating a player moves their value to you. Bots are worth 0; when a bot eats a player, the value spills as loot that only
  real players can collect. Rooms are sharded into instances of 50 players and run 24/7.
- **Cash-out** (`C`, 3 s, 2 s with a Pass) sends the payout on-chain. The fee is charged **on profit only**: 5 % by
  default, 2 % with a Pass, split 50 % treasury / 30 % season pool / 20 % burned. The rate is fixed on-chain when the
  ticket is bought.
- **Slana Pass** is a Metaplex Core NFT with a free mint (rent and network fee only), supply 3,333, one per wallet and a
  commit–reveal trait seed mixed with a slot hash the program records when the mint closes (nobody, the team included,
  can know traits while Passes can be minted; the supply is fixed once the mint opens). Perks: Pass rooms, the 2 % fee, season points and prizes, and **in-game power** (+15 % start
  mass, 2 s cash-out), disclosed on every ticket and in the guide.
- **Seasons:** points come only from Pass tickets; the on-chain top 20 is kept and the top 10 share the pool; 30 days to
  claim.
- **Architecture:** a hybrid model. The authoritative Node server runs the 30 Hz simulation and settles tickets on-chain;
  the Anchor program holds the money rules. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

```bash
corepack enable && pnpm install && pnpm dev     # http://localhost:5173, practice, no wallet needed
```

The player guide is in the app at `/docs` (TR and EN). Deployment and operations are in [docs/DEPLOY.md](docs/DEPLOY.md)
and [docs/OPERATIONS.md](docs/OPERATIONS.md) (Turkish); the architecture and Pass art docs are in English. The program
has **not been audited**, and real-money games may need a licence where you operate.

Lisans / License: [MIT](LICENSE)
