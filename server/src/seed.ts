import type { Category } from '@auction/shared';
import { createAuction } from './services/auctions';
import { hashPassword } from './services/passwords';
import { createUser } from './services/users';

// A regular user that owns the sample listings (there are no admins, RF03).
// Log in with it to see the seller's view of an auction.
export const DEMO_SELLER = { name: 'Arremate Demo', email: 'demo@arremate.dev', password: 'Demo@12345' };

// Placeholder catalog so the UI has something to show in development.
// Prices are in reais here and converted to cents on insert.
const AUCTIONS: { title: string; category: Category; price: number; increment: number; endsIn: number; featured: boolean; description: string }[] = [
  { title: 'Rolex Submariner 1968, mostrador original', category: 'Relógios', price: 85_000, increment: 500, endsIn: 26, featured: true,
    description: 'Ref. 5513 em estado notável, com caixa e comprovantes de revisão de 2019. Um dos relógios de mergulho vintage mais desejados.' },
  { title: 'Pintura a óleo original "Ipanema ao Entardecer"', category: 'Arte', price: 12_000, increment: 250, endsIn: 50, featured: true,
    description: 'Óleo sobre tela de 120 × 80 cm de um artista contemporâneo carioca. Assinada e datada, com certificado de autenticidade.' },
  { title: 'Fusca 1972 totalmente restaurado', category: 'Veículos', price: 38_000, increment: 1_000, endsIn: 8, featured: true,
    description: 'Restauração completa concluída em 2023. Motor 1300 original, estofamento novo e documentação em dia.' },
  { title: 'Leica M6 com Summicron 50mm f/2', category: 'Eletrônicos', price: 21_000, increment: 200, endsIn: 0.4, featured: false,
    description: 'Câmera telemétrica clássica de filme, revisada recentemente. Fotômetro funcionando perfeitamente, leve desgaste na tampa superior.' },
  { title: 'Fender Stratocaster 1979, sunburst', category: 'Música', price: 16_500, increment: 250, endsIn: 72, featured: false,
    description: 'Eletrônica e captadores originais. Toca lindamente e acompanha o case rígido original.' },
  { title: 'MacBook Pro 16" M3 Max, lacrado', category: 'Eletrônicos', price: 18_000, increment: 100, endsIn: 5, featured: false,
    description: '48 GB de RAM, SSD de 1 TB, preto-espacial. Lacrado de fábrica, com nota fiscal e garantia completa.' },
  { title: '"Dom Casmurro", primeira edição (1899)', category: 'Colecionáveis', price: 45_000, increment: 1_000, endsIn: 96, featured: false,
    description: 'Rara primeira edição publicada pela H. Garnier. Encadernação original com desgaste esperado, miolo completo.' },
  { title: 'Air Jordan 1 "Chicago" 1985, tamanho 42', category: 'Moda', price: 30_000, increment: 500, endsIn: 14, featured: false,
    description: 'Par original de 1985, nunca usado, com a caixa original. Autenticado por um serviço independente.' },
  { title: 'Poltrona Eames com banqueta', category: 'Design', price: 27_000, increment: 500, endsIn: 33, featured: false,
    description: 'Produção licenciada Herman Miller em nogueira e couro preto. Pátina leve, estrutura impecável.' },
  { title: 'Charizard Pokémon Base Set, PSA 9', category: 'Colecionáveis', price: 22_000, increment: 250, endsIn: 2, featured: false,
    description: 'Edição Unlimited, nota Mint 9. Case limpo e centralização excelente.' },
  { title: 'Mesa de jantar em jacarandá entalhada à mão', category: 'Design', price: 9_500, increment: 100, endsIn: 40, featured: false,
    description: 'Para oito lugares. Feita nos anos 1960 por uma oficina mineira, com madeira de demolição certificada.' },
];

/** Fills the in-memory store with sample data. Runs on every start, since memory begins empty. */
export async function seed() {
  const seller = createUser({ ...DEMO_SELLER, passwordHash: await hashPassword(DEMO_SELLER.password) });

  AUCTIONS.forEach((auction, i) => {
    createAuction(seller.id, {
      title: auction.title,
      description: auction.description,
      imageUrl: `https://picsum.photos/seed/auction-${i + 1}/960/640`,
      category: auction.category,
      startingPrice: auction.price * 100,
      minIncrement: auction.increment * 100,
      durationMinutes: auction.endsIn * 60,
      featured: auction.featured,
    });
  });
}
