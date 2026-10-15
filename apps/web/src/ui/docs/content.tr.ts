import type { PassPower } from '@slana/shared';
import { FACTS as F, rulesWith, type DocsContent } from './facts';

const nf = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 2 });
const num = (n: number): string => nf.format(n);
/** `500` → `%5`, `450` → `%4,5` (Turkish puts the sign first). */
const pct = (bps: number): string => `%${nf.format(bps / 100)}`;
/** Lamports as SOL with every significant digit (`20000` → `0,00002`). */
const sol = (lamports: number): string => new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 9 }).format(lamports / 1e9);

const [tBps, sBps, bBps] = F.fee.split;
const S = F.server;
const sym = '$SLANA';

/** The player guide in Turkish. Every number comes from `FACTS` (see facts.ts). */
export const docsTr = (symbol: string = sym, power: PassPower | null = null): DocsContent => {
  // I3: the Pass power the server applies (RULES when unknown)
  const R = rulesWith(power);
  return {
  pct,
  num,
  kicker: 'Kılavuz · Oyuncu el kitabı',
  title: 'Bilet, coin, makbuz.',
  deck: `Slana nasıl oynanır, paran nereye gider, Pass ne verir, zincirde ne var: kısa ve açık. Rakamlar oyunun kodundaki varsayılanlardır; yönetici bazılarını değiştirebilir. Bilet keserken onay kartında gördüğün tutarlar esastır.`,
  dateline: [
    `Kesinti ${pct(F.fee.bps)} · Pass ${pct(F.fee.passBps)}`,
    `Cash-out ${R.cashoutS} sn · Pass ${R.passCashoutS} sn`,
    `Oda başına ${F.capacity.arena} oyuncu`,
    `İlk ${F.season.prizeRanks} ödül alır`,
  ],
  tocLabel: 'İçindekiler',
  receipt: {
    title: 'Cash-out',
    titlePass: 'Cash-out · Pass',
    meta: 'Örnek · varsayılan ayarlar',
    entry: 'Giriş bedeli',
    cashout: 'Cash-out değeri',
    profit: 'Kâr',
    fee: (p) => `Kesinti (kârın ${p})`,
    net: 'Cüzdanına',
    split: 'Kesintinin bölüşümü',
    treasury: 'Hazine',
    season: 'Sezon havuzu',
    burn: 'Yakım',
    caption: `${num(F.example.entry)} ${symbol} bilet, ${num(F.example.cashout)} ${symbol} ile cash-out`,
  },
  perkWhere: { chain: 'Zincirde', server: 'Sunucuda' },
  rank: (n) => `${n}.`,
  live: (fee, passFee) => `Bu sunucunun zincir ayarı şu an: kesinti ${fee}, Pass ${passFee}. Bilet, satın alındığı andaki oranı korur.`,
  colophon: `Bu sayfa oyunun kodundaki değerleri kullanır. Akıllı kontrat bağımsız bir denetimden geçmedi; kaybetmeyi göze alabileceğin kadarıyla oyna.`,
  backToTop: 'Başa dön',
  sections: [
    {
      id: 'play',
      title: 'Nasıl oynanır',
      lede: 'Konfeti ye, büyü, senden küçük coin’leri yut, büyüklerden kaç.',
      blocks: [
        {
          kind: 'p',
          text: `Başlamak için cüzdan gerekmez: lobide Antrenman biletini seç ve Hızlı Oyna’ya bas. Coin’in fareyi (telefonda sol alttaki joystick’i) izler. Konfeti yiyerek büyürsün. Bir coin’i yemek için kütlen onunkinin en az ${num(R.eatRatio)} katı olmalı ve onu büyük ölçüde örtmelisin. Büyüdükçe yavaşlarsın.`,
        },
        {
          kind: 'keys',
          caption: 'Kontroller',
          rows: [
            { key: 'Fare', action: 'Hareket (telefonda joystick)' },
            { key: 'Boşluk', action: 'Bölün: bir yarını kaçanların üstüne fırlat' },
            { key: 'W', action: 'Biraz kütle bırak (basılı tutulabilir)' },
            { key: 'C', action: 'Cash-out (biletli odada)' },
            { key: 'Enter', action: 'Sohbet' },
            { key: '1–8', action: 'Çıkartma (emote)' },
            { key: 'Q', action: 'İzlerken sıradaki oyuncu' },
            { key: 'Esc', action: 'Sohbeti ya da açık pencereyi kapat' },
          ],
        },
        {
          kind: 'list',
          items: [
            { term: 'Rug kaktüsleri', text: 'büyük coin’leri parçalara ayırır; küçük coin’ler arkalarına saklanabilir.' },
            { term: 'Airdrop’lar', text: 'güçlendirici bırakır: Mıknatıs, Pump, HODL Kalkanı ve Mega Çanta.' },
            { term: 'Doğuş kalkanı:', text: `Yeni doğan coin ${R.spawnShieldS} sn boyunca yenmez.` },
          ],
        },
      ],
    },
    {
      id: 'rooms',
      title: 'Odalar ve giriş bedelleri',
      lede: 'Antrenman ücretsiz, arenalar biletli. Her arenanın sabit bir giriş bedeli var.',
      blocks: [
        {
          kind: 'list',
          items: [
            {
              term: 'Antrenman',
              text: `ücretsizdir; cüzdan, token ve NFT gerekmez. Botlarla oynanır; ödül, sezon puanı ve zincir kaydı yoktur. Oda başına en fazla ${F.capacity.practice} oyuncu.`,
            },
            {
              term: 'Ligler:',
              text: `Antrenman Çaylak ve Usta olarak ikiye ayrılır. Profil seviyesi ${S.proLevel} ve üstü olanlar Usta’da oynar. Çaylak odasında bir oyunda kütlesi ${num(S.promoteMaxMass)}’i aşan ya da ${S.promoteKills} oyuncu yiyen ${S.promotionHours} saat Usta’ya yönlendirilir. Çaylak botları daha yumuşaktır.`,
            },
            {
              term: 'Arenalar',
              text: `zincirde birer hesaptır. Bilet kestiğinde giriş bedeli arenanın kasasına gider; kasa programın hesabıdır, kimsenin özel anahtarı yoktur. Arenalar 7/24 açıktır, boşken botlar oynar. Bir oda örneğinde en fazla ${F.capacity.arena} gerçek oyuncu olur; dolunca aynı kasayı kullanan yeni bir örnek açılır.`,
            },
            {
              term: 'Tek bilet:',
              text: 'Aynı arenada aynı anda tek açık biletin olabilir. Arenanın aynı anda açık bilet sınırı da vardır.',
            },
          ],
        },
        {
          kind: 'table',
          caption: 'Varsayılan arenalar',
          head: ['No', 'Oda', 'Giriş bedeli', 'Pass'],
          numeric: [0, 2],
          rows: F.arenas.map((a) => [String(a.id), a.name.tr, `${num(a.entry)} ${symbol}`, a.pass ? 'gerekli' : 'gerekmez']),
        },
        {
          kind: 'p',
          text: 'Yönetici bedelleri değiştirebilir, yeni arena açabilir ya da bir arenayı kapatabilir; güncel bedel lobideki bilette yazar. Kesinti oranı bileti kestiğin anda zincire yazılır: sonraki bir değişiklik yalnızca ondan sonra kesilen biletlere uygulanır. Bir arenanın giriş bedeli ve Pass şartı, o arenada açık bilet varken değiştirilemez (zincir kuralı).',
        },
        {
          kind: 'p',
          text: `Bilet için cüzdan, en az giriş bedeli kadar ${symbol} ve biraz SOL gerekir: ağ ücreti, ödeme depozitosu ve oturum hesabının kirası (bilet kapanınca geri döner). İlk biletinde zincir profilin ve gerekirse ${symbol} token hesabın aynı işlemde açılır; bunların kirası da senden çıkar ve hesaplar senin kalır.`,
        },
      ],
    },
    {
      id: 'value',
      title: 'Değer akışı ve ganimet',
      lede: 'Biletli odada coin’in token taşır. Yediğin oyuncunun tokenleri sana geçer.',
      blocks: [
        {
          kind: 'flow',
          label: 'Değerin yolculuğu',
          steps: [
            { title: 'Giriş', text: 'Değerin giriş bedeline eşittir.' },
            { title: 'Yeme', text: 'Yenen hücrenin kütle payı kadar değer yiyene geçer: ⌊V · m / M⌋. Son hücrede kalanın tamamı geçer.' },
            { title: 'Cash-out', text: 'Değerin, kârdan kesinti düşülerek cüzdanına gelir.' },
          ],
        },
        {
          kind: 'list',
          items: [
            { term: 'Botların değeri her zaman 0’dır.', text: 'Bot yemek kütle verir, token vermez. Botlar oda sıralamasında işaretlidir.' },
            {
              term: 'Bot seni yerse',
              text: `kaybettiğin değer ganimet coin’lerine dönüşür ve haritaya saçılır: ⌈V ÷ (bedel / ${R.lootEntryDiv})⌉ parça, en az ${R.lootMin}, en fazla ${R.lootMax}. Parçaların toplamı kaybedilen değere tam olarak eşittir.`,
            },
            { term: 'Ganimet', text: 'kendiliğinden kaybolmaz. Yalnızca gerçek oyuncular toplayabilir; botlar içinden geçer.' },
            { term: 'Kütle değer değildir.', text: 'Kütle bırakmak (W), kaktüs patlaması ve kütle erimesi değerini değiştirmez; değer yalnızca yemekle el değiştirir.' },
            { term: 'Bağlantın koparsa', text: `coin’in ${R.afkS} sn arenada kalır. Geri dönersen devam edersin, dönmezsen otomatik cash-out olur.` },
            { term: 'Ölürsen', text: 'değerin seni yiyen oyuncuya ya da (bot yediyse) ganimete geçer. Bilet kapanır, oturum hesabının kirası sana döner.' },
            { term: 'Süre sınırı:', text: `Bir bilet en fazla ${S.maxTicketHours} saat oynanır; sonra sunucu otomatik cash-out yapar.` },
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          stamp: 'Kasa',
          title: 'Ödeme kasayı aşamaz',
          text: 'Oyundaki tüm değerler (canlı coin’ler, yerdeki ganimet, bekleyen ödemeler) arenanın kasasındaki tokenlerle karşılanır. Program kasada olandan fazlasını ödemez. Sunucu canlı değerleri ve ganimeti her değişiklikte diske yazar; çökerse açık biletler otomatik cash-out’a alınır.',
        },
      ],
    },
    {
      id: 'cashout',
      title: 'Cash-out ve kesinti',
      lede: `C’ye bas (telefonda cash-out düğmesi), ${R.cashoutS} sn hayatta kal, makbuzunu al.`,
      blocks: [
        {
          kind: 'p',
          text: `Cash-out ${R.cashoutS} sn sürer, Pass’li bilette ${R.passCashoutS} sn. Bu sırada bir hücren yenirse cash-out iptal olur; tamamen yenilirsen değerini kaybedersin. Süre dolunca sunucu ödemeyi zincire gönderir ve makbuzda işlem bağlantısı görünür.`,
        },
        {
          kind: 'p',
          text: `Kesinti yalnızca kârdan alınır: kâr = cash-out değeri − giriş bedeli. Zarardaysan ya da başabaşsan kesinti yoktur. Varsayılan oran ${pct(F.fee.bps)}, Pass’li bilette ${pct(F.fee.passBps)}; programın üst sınırı ${pct(F.fee.maxBps)}. Oran bileti kestiğinde biletine yazılır; yönetici ayarı bu arada değiştirse bile cash-out o oranla yapılır.`,
        },
        { kind: 'fee-example' },
        {
          kind: 'p',
          text: `Kesinti üçe bölünür (varsayılan): ${pct(tBps)} hazineye (ekibin geliri), ${pct(sBps)} sezon ödül havuzuna, ${pct(bBps)} yakılır (token arzından kalıcı olarak düşer). Yuvarlamada artan küsurat sezon havuzuna gider.`,
        },
        {
          kind: 'list',
          items: [
            {
              term: 'Depozito:',
              text: `Bilet keserken oturum hesabına küçük bir SOL depozitosu yatırırsın (varsayılan ${num(F.settleFeeLamports)} lamport = ◎${sol(F.settleFeeLamports)}). Ödeme işlemini sunucu gönderir; depozito onun ağ ücretini karşılar. Sunucu cüzdanı bu iş için net para harcamaz.`,
            },
            { term: 'Kira:', text: 'Oturum hesabının (ve Pass ile girdiysen Pass kilidinin) kirası bilet kapanınca sana geri döner.' },
            {
              term: 'Oynanmayan bilet:',
              text: `Bilet kesip odaya hiç girmezsen sunucu biletini yaklaşık ${S.staleTicketMinutes} dakika sonra giriş bedelinden kapatır (kâr olmadığı için kesinti yok).`,
            },
          ],
        },
        {
          kind: 'note',
          tone: 'warn',
          stamp: 'Ödemeni al',
          title: 'Token hesabın yok mu? Oyunun yine sonuçlanır',
          text: `Sunucu oyuncu hesaplarının kirasını hiçbir zaman ödemez. Oyunun bittiğinde ${symbol} token hesabın yoksa (ya da ödemeyi kabul etmiyorsa) sunucu oyunu yine de sonuçlandırır: kesinti kârdan alınır, ödemen arena kasasında kalır ve biletine yazılır. Lobide “Ödemeni al” çıkar: tek işlem gerekirse token hesabını açar (kirası ≈◎0,002, senden çıkar, hesap senin) ve tam tutarı öder. Bekleme süresi yoktur ve bu tutarı senden başkası alamaz. Yalnızca sunucunun hiç sonuçlandırmadığı bir bilet, açılışından ${F.refundHours} saat sonra iade edilebilir: giriş bedelin (kasada yeterliyse) ve depozito dahil tüm SOL sana döner.`,
        },
      ],
    },
    {
      id: 'pass',
      title: 'Slana Pass',
      lede: 'Ücretsiz mint edilen bir NFT. Pass odalarını açar, kesintiyi düşürür, sezon ödülüne hak verir ve oyun içinde güç verir.',
      blocks: [
        {
          kind: 'perks',
          items: [
            { title: 'Pass odaları', text: 'Pass şartlı arenalara yalnızca Pass ile bilet kesilir. Program, Pass’in sahibini ve koleksiyonunu kontrol eder.', where: 'chain' },
            { title: `${pct(F.fee.passBps)} kesinti`, text: `Pass’li bilette kârdan ${pct(F.fee.passBps)} kesilir (Pass’siz ${pct(F.fee.bps)}).`, where: 'chain' },
            { title: 'Sezon puanı ve ödülü', text: 'Sezon puanı yalnızca Pass’li biletlerle kazanılır; sezon ödülü de yalnızca tabloya girenlere gider.', where: 'chain' },
            {
              title: `+${pct(R.passStartPct * 100)} başlangıç, ${R.passCashoutS} sn cash-out`,
              text: `Pass’li biletle arenada (ve Pass takarak antrenmanda) +${pct(R.passStartPct * 100)} kütleyle başlarsın ve ${R.passCashoutS} sn’de (normalde ${R.cashoutS} sn) cash-out yaparsın.`,
              where: 'server',
            },
            { title: 'Coin görünümü', text: 'Pass’inin risograf coin karakteri oyundaki görünümün olur; sunucu sahipliği doğrular.', where: 'server' },
          ],
        },
        {
          kind: 'note',
          tone: 'warn',
          stamp: 'Açık beyan',
          title: 'Pass oyun içinde güç verir',
          text: `Pass’li bir bilet +${pct(R.passStartPct * 100)} kütleyle başlar ve ${R.passCashoutS} sn’de (normalde ${R.cashoutS} sn) cash-out yapar. Bu, aynı odadaki Pass’siz oyunculara karşı gerçek bir avantajdır. Pass ücretsiz mint edilir ama pazar yerlerinde parayla alınıp satılabilir, yani bu avantaj satın alınabilir: “pay-to-win”e yakındır. Bilet onayındaki Pass satırı bu avantajları tek tek yazar. Değerler sunucu ayarıdır; yönetici değiştirebilir ya da kapatabilir.`,
        },
        {
          kind: 'list',
          items: [
            { term: 'İsteğe bağlı:', text: 'Pass’siz bir arenada Pass kullanmak senin seçimindir: bilet onayında “Pass’imle gir”i seçersen avantajlar o bilet için açılır.' },
            {
              term: 'Kilit:',
              text: 'Bir Pass aynı anda tek bir bilete bağlanır. Kilit, bilet kapanınca (cash-out, ölüm ya da iade) kalkar ve kirası sana döner. Pass’i oyun sırasında devretsen bile yeni sahip kilit kalkana kadar onu bilete bağlayamaz.',
            },
            { term: 'Bilet anında:', text: 'Pass ve kesinti oranı (Pass’li ya da normal) bilet kesilirken zincire yazılır; sonradan kesinti değişikliği ya da Pass almak/satmak açık bileti değiştirmez.' },
          ],
        },
      ],
    },
    {
      id: 'mint',
      title: 'Mint ve açılış',
      lede: `Pass ücretsizdir: ${symbol} ödemezsin, yalnızca hesap kirası ve ağ ücreti (SOL).`,
      blocks: [
        {
          kind: 'steps',
          items: [
            'Pass sekmesinde başvuru formunu aç. Mint açıksa kalan arz ve sayaç görünür.',
            `Cüzdanınla imzala. İşlem yeni bir NFT varlığı oluşturur; numaran sıralıdır (#1, #2, …). Cüzdanından ${symbol} çıkmamalı, yalnızca SOL (kira ve ağ ücreti). Mint ekranı kesin tutarı imzadan önce gösterir; bu kira NFT’de kalır, geri dönmez.`,
            'Pass zarfta, mühürlü gelir. Görünümü ve özellikleri mint kapandıktan sonra bütün koleksiyon için aynı anda açılır.',
          ],
        },
        {
          kind: 'list',
          items: [
            { term: 'Arz:', text: `Varsayılan ${num(F.pass.supply)} Pass; cüzdan başına ${F.pass.perWallet}.` },
            { term: 'Şartlar:', text: `Yönetici mint için bir başlangıç saati ve isteğe bağlı olarak cüzdanda en az şu kadar ${symbol} şartı koyabilir (varsayılan: şart yok).` },
            {
              term: 'Adil açılış (commit–reveal + zincir entropisi):',
              text: 'Mint başlamadan önce yönetici gizli bir tohumun özetini (sha256) zincire yazar. Mint kapanınca ya da arz bitince bir daha açılamaz. Sonra yönetici tohumu açıklar (program özeti doğrular) ve ancak ondan sonra program yaklaşık bir dakika sonrasındaki bir Solana slotunu seçer. O slot geçince herkes onun hash’ini (entropi) zincire kaydedebilir: oyun sunucusu bunu kendiliğinden yapar, Pass sayfasında da her cüzdan için “Açılışı tamamla” düğmesi vardır. Program son tohumu = sha256(tohum + entropi) saklar. Her Pass’in özellikleri bu son tohumdan ve numarasından hesaplanır: Pass basılabildiği sürece hangi numaranın nadir olacağını kimse, ekip dahil, bilemez; tohum slottan önce açık olduğu için sonucu herkes aynı anda öğrenir. Sonucu beğenmeyen biri ~3 dakikalık pencerenin yakalama olmadan geçmesini umabilir (bu yeni bir slot seçer), ama herkes ondan önce yakalayabilir; zamanlamayı tek bir taraf kontrol edemez.',
            },
            { term: 'Görünüm:', text: 'Açılıştan önce bütün Pass’ler oyunda ve pazar yerlerinde “mühürlü pasaport” olarak görünür. Pass sayfasında, yönetici eklediyse, pazar yeri bağlantıları bulunur.' },
          ],
        },
      ],
    },
    {
      id: 'seasons',
      title: 'Sezonlar',
      lede: `Pass’li biletlerle puan topla, ilk ${F.season.prizeRanks}’a gir, havuzdan payını al.`,
      blocks: [
        {
          kind: 'list',
          items: [
            {
              term: 'Puan:',
              text: `Yalnızca Pass’li biletlerle oynanan arena oyunlarından gelir; cash-out da yapsan ölsen de sayılır. Bir oyunun puanı ulaştığın en yüksek kütledir (oyun başına üst sınır ${num(F.season.maxScore)}) ve sezon boyunca toplanır.`,
            },
            { term: 'Tablo', text: `zincirde tutulur ve ilk ${F.season.boardSize}’yi gösterir; ilk ${F.season.prizeRanks} ödül alır.` },
            { term: 'Havuz', text: `oyuncu kesintilerinin sezon payından (varsayılan ${pct(sBps)}) ve kapatılan arenaların artıklarından dolar. Ekip havuzu fonlamaz.` },
            { term: 'Bitiş:', text: 'Sezonun zincirde sabit bir bitiş zamanı yoktur. Yönetici sezonu bitirir; havuz o an dondurulur ve yeni sezon başlar.' },
            {
              term: 'Talep:',
              text: `Ödülünü Sıralama sayfasından kendin talep edersin; süre sezon bittikten sonra ${F.season.claimDays} gündür. Süre dolunca talep edilmeyen ödüller yönetici tarafından aktif sezonun havuzuna aktarılır.`,
            },
          ],
        },
        { kind: 'prizes', caption: 'Ödül payları (dondurulan havuzun yüzdesi)' },
      ],
    },
    {
      id: 'fair',
      title: 'Adil oyun ve şeffaflık',
      lede: 'Para kuralları zincirde, oyunun kendisi sunucuda. Neye güvendiğini bil.',
      blocks: [
        {
          kind: 'compare',
          left: {
            title: 'Zincirde: program kuralı, herkes doğrulayabilir',
            items: [
              'Giriş bedelleri arenanın kasasında durur; ödeme kasadakinden fazla olamaz.',
              `Kesinti yalnızca kârdan; oran üst sınırı ${pct(F.fee.maxBps)}. Bölüşüm, yakım ve sezon havuzu.`,
              'Her biletin benzersiz bir numarası vardır; eski bir ödeme yeni bilete uygulanamaz.',
              `Sonuçlanmış ödemeyi her an alma; hiç sonuçlanmamış bileti ${F.refundHours} saat sonra kendin iade alma.`,
              'Pass kapısı, Pass kilidi, mint limitleri, mint açılınca sabitlenen arz ve zincir entropili commit–reveal.',
              'Her biletin kesinti oranı, kesildiği anda sabitlenir.',
              `Sezon tablosu, ödül payları ve ${F.season.claimDays} günlük talep süresi.`,
            ],
          },
          right: {
            title: 'Sunucuda: buna güvenirsin',
            items: [
              'Fizik ve oyun sonucu: kim kimi yedi, cash-out anında değerin ne. Ödeme tutarını sunucu imzalar.',
              'Skor, XP ve öldürme sayıları (sezon puanı buradan gelir).',
              'Botlar, eşleştirme ve ligler.',
              'Pass gücü ve Pass görünümünün doğrulanması.',
              'Sunucunun Bugün / Tüm zamanlar tabloları ve sohbet filtresi.',
            ],
          },
        },
        {
          kind: 'p',
          text: 'Sunucu anahtarı yalnızca açık biletleri kapatabilir: ödemeyi bir arenanın kasasından yapar; hazineye, sezon kasasına ve ayarlara dokunamaz. Yine de hatalı ya da kötü niyetli bir sunucu bir arenanın kasasını oyuncular arasında yanlış dağıtabilir. Gerçek zamanlı oyunlar için standart olan bu hibrit model sunucuya güven gerektirir.',
        },
        {
          kind: 'p',
          text: `Yönetici ayarları değiştirebilir (kesinti en fazla ${pct(F.fee.maxBps)}), yeni bilet satışını durdurabilir (ödemeler ve iadeler durmaz), arenaları kapatabilir, sezonu bitirebilir, hazineyi çekebilir ve sunucu anahtarını değiştirebilir; bu yüzden sunucuya güven, sonuçta yöneticiye güvendir. Arena kasalarını kendine aktaramaz: kapatılan bir arenanın artığı yalnızca sezon havuzuna süpürülebilir. Yönetici taahhüt edilen Pass tohumunu bilir, ama özellikler mint kapanıp tohum açıklandıktan sonra seçilen bir slotun hash’ine de bağlıdır; bu yüzden Pass basılabildiği sürece yönetici bile onları bilemez ve sonucu herkes aynı anda öğrenir. İki cüzdanla birbirini besleme (takımlaşma) bu sürümde tespit edilmez.`,
        },
        {
          kind: 'note',
          tone: 'warn',
          stamp: 'Denetimsiz',
          title: 'Akıllı kontrat denetlenmedi',
          text: 'Program bağımsız bir güvenlik denetiminden geçmedi. Yalnızca kaybetmeyi göze alabileceğin kadarıyla oyna.',
        },
      ],
    },
    {
      id: 'wallet',
      title: 'Cüzdan güvenliği',
      lede: 'İmzalamadan önce oku. Slana senden hiçbir zaman gizli kelimelerini istemez.',
      blocks: [
        {
          kind: 'list',
          items: [
            { term: 'Giriş', text: '(doğrulama) yalnızca bir mesaj imzasıdır: “Slana wants you to sign in with your Solana account” diye başlar, işlem göndermez, ücret almaz.' },
            { term: 'Bilet işleminde', text: `cüzdanın yalnızca giriş bedeli kadar ${symbol} ve küçük SOL tutarları (ağ ücreti, depozito, kira) göstermeli. Fazlasını görürsen imzalama.` },
            { term: 'Mint işleminde', text: `cüzdanından ${symbol} çıkmamalı; yalnızca SOL (kira ve ücret).` },
            { term: 'Gizli kelimelerini', text: '(seed phrase) ya da özel anahtarını isteyen her site, kişi ya da “destek” dolandırıcıdır.' },
            { term: 'Ayrı cüzdan:', text: 'Oyun için ayrı bir cüzdan kullan ve içinde yalnızca oynamak istediğin kadar tut.' },
            { term: 'Bağlantılar:', text: 'Adres çubuğunu kontrol et. DM’den gelen “airdrop” ya da “mint” bağlantılarına tıklama.' },
          ],
        },
      ],
    },
    {
      id: 'faq',
      title: 'SSS',
      lede: 'Kısa cevaplar.',
      blocks: [
        {
          kind: 'faq',
          items: [
            { q: 'Antrenman için cüzdan gerekir mi?', a: 'Hayır. Antrenman ücretsizdir; cüzdan, token ve NFT gerekmez.' },
            {
              q: `${symbol} nereden alınır?`,
              a: `Bir merkeziyetsiz borsadan. Doğru mint adresini yalnızca resmi kanallardan doğrula; program yalnızca kurulumda bir kez kaydedilen tek bir mint’i kabul eder.`,
            },
            { q: 'Botları yersem token kazanır mıyım?', a: 'Hayır. Botların değeri her zaman 0’dır; yalnızca kütle kazanırsın.' },
            { q: 'Bağlantım koptu ya da sekmeyi kapattım.', a: `Coin’in ${R.afkS} sn arenada kalır. Bu sürede dönersen kaldığın yerden devam edersin; dönmezsen otomatik cash-out olur.` },
            {
              q: 'Bilet kestim ama oynamadım.',
              a: `Sunucu yaklaşık ${S.staleTicketMinutes} dakika sonra biletini giriş bedelinden kapatır. Sunucu bunu yapmazsa ${F.refundHours} saat sonra kendin iade alırsın.`,
            },
            {
              q: 'Ödemem gelmedi.',
              a: `Lobideki ödeme bandına bak. “Ödemeni al” yazıyorsa oyunun sonuçlandı ve ödemen kasada bekliyor: tek işlemle hemen al (gerekirse token hesabın aynı işlemde açılır). Ödemenin yolda olduğunu yazıyorsa sunucu hâlâ gönderiyor; ağ sorunlarında kendisi yeniden dener.`,
            },
            { q: 'Sezon puanım neden artmıyor?', a: 'Puan yalnızca Pass’li biletlerle oynanan arena oyunlarından gelir. Antrenman ve Pass’siz biletler puan vermez.' },
            { q: 'Pass’imi satarsam ne olur?', a: 'Açık bir bilete kilitliyse kilit kalkana kadar yeni sahip onu kullanamaz. Avantajlar bilet kesilirken yazıldığı için açık biletin Pass’li kalır.' },
            { q: 'Kesintiyi kim alır?', a: `Varsayılan olarak ${pct(tBps)} hazineye, ${pct(sBps)} sezon havuzuna gider, ${pct(bBps)} yakılır.` },
            {
              q: 'Bu bir kumar mı?',
              a: 'Gerçek değerli bir tokenle oynanan bir beceri oyunudur ve birçok ülkede düzenlemeye tabi olabilir. Bulunduğun yerde oynamanın yasal olduğundan emin ol. Sezon ödülleri ve yakım bir getiri vaadi değildir.',
            },
          ],
        },
      ],
    },
  ],
};
};
