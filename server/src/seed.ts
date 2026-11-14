import type { Category } from '@auction/shared';
import { createAuction, placeBid } from './services/auctions';
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

// Placeholder catalog so the UI has something to show in development.
// Prices are in reais here and converted to cents on insert.
// `startsIn`/`endsIn` are hours from now: a negative start means it's already running.
const AUCTIONS: { title: string; category: Category; price: number; startsIn?: number; endsIn: number; featured: boolean; description: string }[] = [
  { title: 'Rolex Submariner 1968, mostrador original', category: 'Relógios', price: 85_000, endsIn: 26, featured: true,
    description: 'Ref. 5513 em estado notável, com caixa e comprovantes de revisão de 2019. Um dos relógios de mergulho vintage mais desejados.' },
  { title: 'Pintura a óleo original "Ipanema ao Entardecer"', category: 'Arte', price: 12_000, endsIn: 50, featured: true,
    description: 'Óleo sobre tela de 120 × 80 cm de um artista contemporâneo carioca. Assinada e datada, com certificado de autenticidade.' },
  { title: 'Fusca 1972 totalmente restaurado', category: 'Veículos', price: 38_000, endsIn: 8, featured: true,
    description: 'Restauração completa concluída em 2023. Motor 1300 original, estofamento novo e documentação em dia.' },
  { title: 'Leica M6 com Summicron 50mm f/2', category: 'Eletrônicos', price: 21_000, endsIn: 0.4, featured: false,
    description: 'Câmera telemétrica clássica de filme, revisada recentemente. Fotômetro funcionando perfeitamente, leve desgaste na tampa superior.' },
  { title: 'Fender Stratocaster 1979, sunburst', category: 'Música', price: 16_500, endsIn: 72, featured: false,
    description: 'Eletrônica e captadores originais. Toca lindamente e acompanha o case rígido original.' },
  { title: 'MacBook Pro 16" M3 Max, lacrado', category: 'Eletrônicos', price: 18_000, endsIn: 5, featured: false,
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
];

/** Sample data for the very first start (when there's no saved data on disk yet). */
export async function seed() {
  const seller = createUser({ ...DEMO_SELLER, passwordHash: await hashPassword(DEMO_SELLER.password) });

  const buyers = [];
  for (const buyer of DEMO_BUYERS) {
    buyers.push(createUser({ ...buyer, passwordHash: await hashPassword(buyer.password) }));
  }

  const createdAuctions = AUCTIONS.map((auction, i) => {
    const startsAt = Date.now() + (auction.startsIn ?? -1) * HOUR;
    return createAuction(seller.id, {
      title: auction.title,
      description: auction.description,
      category: auction.category,
      // Placeholder pictures; real auctions upload their own (at least 3, RF05)
      photos: [1, 2, 3].map((n) => `https://picsum.photos/seed/auction-${i + 1}-${n}/960/640`),
      startingPrice: auction.price * 100,
      startsAt,
      durationMinutes: Math.round((Date.now() + auction.endsIn * HOUR - startsAt) / 60_000),
      featured: auction.featured,
    });
  });

  // Coloca alguns lances iniciais nos leilões ativos para demonstrar líder e histórico (RF09)
  try {
    const liveAuction = createdAuctions[0]; // Rolex
    if (liveAuction) {
      placeBid(liveAuction.id, buyers[0], 85_000_00, 'seed-bid-1');
      placeBid(liveAuction.id, buyers[1], 85_500_00, 'seed-bid-2');
    }
  } catch {
    // ignora se leilão não aceitou lance durante seed
  }
}
