import type { Category } from '@auction/shared';
import { cancelAuction, createAuction, placeBid } from './services/auctions';
import { hashPassword } from './services/passwords';
import { createUser } from './services/users';

const HOUR = 60 * 60 * 1000;

// A regular user that owns the sample listings (there are no admins, RF03).
// Log in with it to see the seller's view of an auction.
export const DEMO_SELLER = { name: 'Arremate Demo', email: 'demo@arremate.dev', password: 'Demo@12345' };

// Sample buyers for demonstration (RNF04: ao menos 1 comitente e 3 compradores).
export const DEMO_BUYERS = [
  { name: 'Bernardo Lima', email: 'comprador1@arremate.dev', password: 'Demo@12345' },
  { name: 'Camila Rocha', email: 'comprador2@arremate.dev', password: 'Demo@12345' },
  { name: 'Daniel Souza', email: 'comprador3@arremate.dev', password: 'Demo@12345' },
];

interface SampleAuction {
  title: string;
  category: Category;
  /** Starting price in reais (converted to cents on insert). */
  price: number;
  /** Hours from now; negative is in the past. No start means it started an hour ago. */
  startsIn?: number;
  endsIn: number;
  featured: boolean;
  description: string;
  /** [buyer index in DEMO_BUYERS, amount in reais, hours from now], placed through the normal bid rules. */
  bids?: [number, number, number][];
  /** Cancelled by the seller right after being created (only while scheduled, RF08). */
  cancelled?: boolean;
}

// Sample catalog in every state (RNF04): live with and without bids, scheduled, sold, ended
// without bids and cancelled.
const AUCTIONS: SampleAuction[] = [
  { title: 'Rolex Submariner 1968, mostrador original', category: 'Relógios', price: 85_000, endsIn: 26, featured: true, bids: [[0, 85_000, -0.8], [1, 85_500, -0.5]],
    description: 'Ref. 5513 em estado notável, com caixa e comprovantes de revisão de 2019. Um dos relógios de mergulho vintage mais desejados.' },
  { title: 'Pintura a óleo original "Ipanema ao Entardecer"', category: 'Arte', price: 12_000, endsIn: 50, featured: true,
    description: 'Óleo sobre tela de 120 × 80 cm de um artista contemporâneo carioca. Assinada e datada, com certificado de autenticidade.' },
  { title: 'Fusca 1972 totalmente restaurado', category: 'Veículos', price: 38_000, endsIn: 8, featured: true,
    description: 'Restauração completa concluída em 2023. Motor 1300 original, estofamento novo e documentação em dia.' },
  { title: 'Leica M6 com Summicron 50mm f/2', category: 'Eletrônicos', price: 21_000, endsIn: 0.4, featured: false,
    description: 'Câmera telemétrica clássica de filme, revisada recentemente. Fotômetro funcionando perfeitamente, leve desgaste na tampa superior.' },
  { title: 'Fender Stratocaster 1979, sunburst', category: 'Música', price: 16_500, endsIn: 72, featured: false,
    description: 'Eletrônica e captadores originais. Toca lindamente e acompanha o case rígido original.' },
  { title: 'MacBook Pro 16" M3 Max, lacrado', category: 'Eletrônicos', price: 18_000, endsIn: 5, featured: false, bids: [[2, 18_000, -0.6], [0, 18_500, -0.3], [2, 19_000, -0.1]],
    description: '48 GB de RAM, SSD de 1 TB, preto-espacial. Lacrado de fábrica, com nota fiscal e garantia completa.' },
  { title: '"Dom Casmurro", primeira edição (1899)', category: 'Colecionáveis', price: 45_000, endsIn: 96, featured: false,
    description: 'Rara primeira edição publicada pela H. Garnier. Encadernação original com desgaste esperado, miolo completo.' },
  { title: 'Air Jordan 1 "Chicago" 1985, tamanho 42', category: 'Moda', price: 30_000, endsIn: 14, featured: false,
    description: 'Par original de 1985, nunca usado, com a caixa original. Autenticado por um serviço independente.' },
  { title: 'Poltrona Eames com banqueta', category: 'Design', price: 27_000, endsIn: 33, featured: false,
    description: 'Produção licenciada Herman Miller em nogueira e couro preto. Pátina leve, estrutura impecável.' },
  { title: 'Charizard Pokémon Base Set, PSA 9', category: 'Colecionáveis', price: 22_000, endsIn: 2, featured: false,
    description: 'Edição Unlimited, nota Mint 9. Case limpo e centralização excelente.' },
  { title: 'Vitrola Gradiente anos 70, funcionando', category: 'Música', price: 1_800, startsIn: 0.25, endsIn: 3, featured: false,
    description: 'Toca-discos com receiver embutido, revisado. Acompanha tampa de acrílico original e manual.' },
  { title: 'Mesa de jantar em jacarandá entalhada à mão', category: 'Design', price: 9_500, endsIn: 40, featured: false,
    description: 'Para oito lugares. Feita nos anos 1960 por uma oficina mineira, com madeira de demolição certificada.' },
  // Already over: sold (with a winner), and ended without bids
  { title: 'Câmera Rolleiflex 2.8F com estojo de couro', category: 'Eletrônicos', price: 6_000, startsIn: -50, endsIn: -2, featured: false,
    bids: [[0, 6_000, -40], [1, 6_100, -30], [2, 6_300, -5]],
    description: 'Lente Planar 80mm, obturador revisado em 2022. Acompanha estojo, tampa e alça originais.' },
  { title: 'Disco "Acabou Chorare" (1972), primeira prensagem', category: 'Música', price: 900, startsIn: -30, endsIn: -1, featured: false,
    bids: [[1, 900, -20], [0, 950, -10]],
    description: 'Novos Baianos, Som Livre. Capa e encarte originais, vinil sem riscos.' },
  { title: 'Luminária Tiffany com cúpula de vitral', category: 'Design', price: 3_200, startsIn: -26, endsIn: -3, featured: false,
    description: 'Vitral artesanal com motivos florais, base em bronze. Altura de 62 cm.' },
  // Cancelled by the seller before it started
  { title: 'Bicicleta Caloi 10 (1980), toda original', category: 'Veículos', price: 2_500, startsIn: 24, endsIn: 48, featured: false, cancelled: true,
    description: 'Câmbio Shimano e pintura de fábrica. Pneus novos, o resto como saiu da loja.' },
];

/** Sample data for the very first start (when there's no saved data on disk yet). */
export async function seed() {
  const seller = createUser({ ...DEMO_SELLER, passwordHash: await hashPassword(DEMO_SELLER.password) });

  const buyers = [];
  for (const buyer of DEMO_BUYERS) {
    buyers.push(createUser({ ...buyer, passwordHash: await hashPassword(buyer.password) }));
  }

  const now = Date.now();
  const bids: { auctionId: number; buyer: number; amount: number; at: number }[] = [];
  AUCTIONS.forEach((auction, i) => {
    const startsAt = now + (auction.startsIn ?? -1) * HOUR;
    const { id } = createAuction(seller.id, {
      title: auction.title,
      description: auction.description,
      category: auction.category,
      // Placeholder pictures; real auctions upload their own (at least 3, RF05)
      photos: [1, 2, 3].map((n) => `https://picsum.photos/seed/auction-${i + 1}-${n}/960/640`),
      startingPrice: auction.price * 100,
      startsAt,
      durationMinutes: Math.round((now + auction.endsIn * HOUR - startsAt) / 60_000),
      featured: auction.featured,
    });
    if (auction.cancelled) cancelAuction(id, seller.id);
    for (const [buyer, amount, hours] of auction.bids ?? []) bids.push({ auctionId: id, buyer, amount: amount * 100, at: now + hours * HOUR });
  });

  // In the order they happened, as if placed at that time: the normal rules apply (minimum,
  // live at that moment, time between bids), so the sample data can't break them
  bids.sort((a, b) => a.at - b.at);
  for (const [n, bid] of bids.entries()) placeBid(bid.auctionId, buyers[bid.buyer], bid.amount, `seed-${n}`, bid.at);
}
