# Slana — Kurulum ve Dağıtım Rehberi (Devnet → Mainnet)

Bu rehber; Solana programını dağıtmayı, yapılandırmayı, oyun sunucusunu ve web istemcisini yayına almayı adım adım anlatır.
**Önce devnet'te deneyin, sonra mainnet'e geçin.**

> ⚠️ **Yasal & güvenlik uyarısı.** SOL ile oynanan arenalar gerçek parayla oynanan bir oyundur ve bulunduğunuz ülkede
> lisans gerektirebilir. Akıllı kontrat bağımsız bir denetimden geçmemiştir. Mainnet'te gerçek parayla açmadan önce
> denetim yaptırın, küçük limitlerle başlayın ve `STAKE_ENABLED=false` ile sadece ücretsiz modu açmayı değerlendirin.

---

## 0. Gerekenler

| Araç | Sürüm | Not |
|---|---|---|
| Node.js | 22+ | `corepack enable` ile pnpm 10 |
| Rust | 1.97.1 | `rust-toolchain.toml` otomatik seçer (`rustup show`) |
| Solana (Agave) CLI | 4.3.x | `sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"` |
| Anchor CLI | 1.2.1 | `npm i -g @anchor-lang/cli@1.2.1` |

```bash
pnpm install
```

## 1. Program anahtarı ve derleme

Repodaki `declare_id!` geliştirme sırasında üretilmiş bir adrese aittir; **kendi program anahtarınızı üretin**:

```bash
solana-keygen new -o target/deploy/slana-keypair.json   # bu dosyayı GÜVENLE yedekleyin
anchor keys sync                                        # declare_id! + Anchor.toml güncellenir
anchor build                                            # target/deploy/slana.so + IDL
pnpm -F @slana/sdk sync-idl                             # IDL'i SDK'ya kopyalar (istemci/sunucu bunu kullanır)
cargo test -p slana                                     # LiteSVM testleri
```

## 2. Devnet

```bash
solana config set --url devnet
solana-keygen new -o ~/.config/solana/id.json   # (yoksa) yönetici cüzdanı — programın upgrade authority'si olur
solana airdrop 5                                 # gerekirse https://faucet.solana.com
anchor deploy --provider.cluster devnet
```

Sunucu anahtarı (settlement'ları imzalar) ve hazine adresi:

```bash
mkdir -p keys
solana-keygen new -o keys/server.json --no-bip39-passphrase
solana transfer $(solana-keygen pubkey keys/server.json) 0.5 --allow-unfunded-recipient
TREASURY=<hazine cüzdanınızın adresi>   # tercihen bir multisig (Squads) — önceden fonlanmış olmalı
```

Programı başlatın ve arenaları oluşturun (yönetici = programın upgrade authority'si olmalı; aksi halde `initialize` reddedilir):

```bash
pnpm admin init --url https://api.devnet.solana.com \
  --server $(solana-keygen pubkey keys/server.json) --treasury $TREASURY \
  --fee-bps 500 --season-share-bps 5000 --skin-price-sol 0.05
pnpm admin create-arena --url https://api.devnet.solana.com --defaults   # ◎0.01 / ◎0.05 / ◎0.1
pnpm admin status --url https://api.devnet.solana.com
```

Oyun sunucusu (`apps/server/.env`, örnek: `apps/server/.env.example`):

```bash
SOLANA_CLUSTER=devnet
SOLANA_RPC_URL=https://api.devnet.solana.com
PROGRAM_ID=<program id>
SERVER_KEYPAIR=/abs/path/keys/server.json
AUTH_SECRET=$(openssl rand -hex 32)
DATA_DIR=./data
```

```bash
pnpm dev            # sunucu :8787 + web :5173 (Vite /ws ve /api'yi sunucuya yönlendirir)
```

## 3. Mainnet

1. **Maliyet:** program ~430 KB → kalıcı kira ≈ **◎2.98**. Dağıtım sırasında buffer hesabı için geçici olarak ≈ ◎6 bulundurun
   (dağıtımdan sonra iade edilir). Config/sezon hesapları için ≈ ◎0.02 ek.
2. **Ücretli RPC** kullanın (Helius, QuickNode, Triton…). `SOLANA_RPC_URL` gizli anahtar içerebilir; tarayıcıya
   gidecek `PUBLIC_RPC_URL` ise gizli olmayan (kısıtlı/domain kilitli) bir uç nokta olmalı.
3. Dağıtım:
   ```bash
   solana config set --url mainnet-beta
   anchor deploy --provider.cluster mainnet
   pnpm admin init --url $RPC --server <SERVER_PUBKEY> --treasury <MULTISIG>
   pnpm admin create-arena --url $RPC --defaults
   ```
4. **Yetkileri sağlamlaştırın** (`initialize` sonrasında):
   - Upgrade authority'yi multisig'e taşıyın: `solana program set-upgrade-authority <PROGRAM_ID> --new-upgrade-authority <MULTISIG>`
   - Config admin'ini multisig'e taşıyın: `pnpm admin update-config --admin <MULTISIG>`
   - Sunucu cüzdanında sadece işlem ücretleri için az SOL tutun (≈ ◎0.2). Bakiye ◎0.05'in altına düşünce sunucu uyarır.
5. **Acil durum:** `pnpm admin update-config --paused true` yeni girişleri durdurur; settlement ve iadeler çalışmaya devam eder.
   Sunucu anahtarı sızarsa: `update-config --server <YENİ_ANAHTAR>`.

## 4. Barındırma

### Tek konteyner (önerilen)
Sunucu, derlenmiş web istemcisini aynı porttan servis eder:

```bash
docker build -t slana .
docker run -d --name slana -p 8787:8787 \
  -v slana-data:/data --env-file apps/server/.env \
  -v $(pwd)/keys/server.json:/keys/server.json:ro -e SERVER_KEYPAIR=/keys/server.json \
  slana
```

- Önüne TLS sonlandıran bir ters vekil (Caddy/Nginx/Cloudflare) koyun; WebSocket yolu `/ws`.
- **`/data` kalıcı olmalı**: `journal.json` sunucunun oyunculara borçlu olduğu ödemeleri tutar. Silinirse yarıda kalan
  stake oturumları 15 dk sonra giriş ücretiyle iade edilir (adil ama ideal değil).
- Fly.io / Render / Railway / bir VPS — WebSocket ve kalıcı disk destekleyen herhangi bir platform.

### Ayrık barındırma
- İstemci: `VITE_SERVER_URL=https://game.example.com pnpm -F @slana/web build` → `apps/web/dist` (Vercel/Netlify/Cloudflare Pages).
- Sunucu: `pnpm -F @slana/server build && node apps/server/dist/index.js` (veya Docker), `CORS_ORIGIN=https://example.com`.

## 5. Operasyon

`pnpm admin` komutları `--url` verilmezse `$SOLANA_RPC_URL`'i (yoksa localnet'i), `--program` verilmezse `$PROGRAM_ID`'yi,
imzacı olarak da `~/.config/solana/id.json`'u (`--keypair` ile değiştirilebilir) kullanır. Tüm komutlar: `pnpm admin help`.

| İş | Komut |
|---|---|
| Durum (config, arenalar, kasalar, sezon) | `pnpm admin status` |
| Sezon ödül havuzuna bağış | `pnpm admin fund-season --sol 1` |
| Sezonu bitir (ilk 10 ödül alır, yeni sezon başlar) | `pnpm admin end-season` |
| 30 gün sonra talep edilmeyen ödülleri aktif sezona aktar | `pnpm admin rollover --season N` |
| Arena aç/kapat, kapasite | `pnpm admin update-arena --id 2 --enabled false` |
| Açık oturumu kalmamış arenanın artığını hazineye al | `pnpm admin sweep --id 2` |

Önerilen ritim: her ay `end-season`; ücretlerin yarısı (varsayılan `season_share_bps=5000`) zaten otomatik olarak sezon havuzuna akar.

## 6. Güven modeli (özet)

- Para hareketlerinin tamamı zincir üstünde ve denetlenebilir (arena hesabı kasadır; ödeme kasayı aşamaz, kasa her zaman kira-muaf kalır).
- Oyun sonucunun doğruluğu yetkili oyun sunucusuna güvenir (gerçek zamanlı oyunlar için standart hibrit model).
- Sunucu, oturum yaşını 6 saatte zorla kapatır; oyuncu 24 saat settle edilmemiş biletini kendisi iade alabilir.
- `settle_session` ilgili oturumun benzersiz `session_id`'sini ister; yeniden denenen eski bir ödeme aynı PDA'daki yeni oturuma uygulanamaz.
