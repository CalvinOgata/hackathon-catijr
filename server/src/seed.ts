import type { Category } from '@auction/shared';
import { createAuction } from './services/auctions';
import { hashPassword } from './services/passwords';
import { createUser } from './services/users';

// A regular user that owns the sample listings (there are no admins, RF03).
// Log in with it to see the seller's view of an auction.
export const DEMO_SELLER = { name: 'Arremate Demo', email: 'demo@arremate.dev', password: 'demo12345' };

// Placeholder catalog so the UI has something to show in development.
// Prices are in reais here and converted to cents on insert.
const AUCTIONS: { title: string; category: Category; price: number; increment: number; endsIn: number; featured: boolean; description: string }[] = [
  { title: 'Rolex Submariner 1968, original dial', category: 'Watches', price: 85_000, increment: 500, endsIn: 26, featured: true,
    description: 'Ref. 5513 in remarkable condition, with box and service papers from 2019. One of the most sought-after vintage divers.' },
  { title: 'Original oil painting "Ipanema ao Entardecer"', category: 'Art', price: 12_000, increment: 250, endsIn: 50, featured: true,
    description: '120 × 80 cm oil on canvas by a Rio-based contemporary artist. Signed and dated, with certificate of authenticity.' },
  { title: '1972 Volkswagen Fusca, fully restored', category: 'Vehicles', price: 38_000, increment: 1_000, endsIn: 8, featured: true,
    description: 'Frame-off restoration completed in 2023. Original 1300 engine, new upholstery and documentation up to date.' },
  { title: 'Leica M6 with Summicron 50mm f/2', category: 'Electronics', price: 21_000, increment: 200, endsIn: 0.4, featured: false,
    description: 'Classic rangefinder film camera, recently CLA\'d. Light meter works perfectly, minor brassing on the top plate.' },
  { title: 'Fender Stratocaster 1979, sunburst', category: 'Music', price: 16_500, increment: 250, endsIn: 72, featured: false,
    description: 'All-original electronics and pickups. Plays beautifully, comes with the original hard case.' },
  { title: 'MacBook Pro 16" M3 Max, sealed', category: 'Electronics', price: 18_000, increment: 100, endsIn: 5, featured: false,
    description: '48 GB RAM, 1 TB SSD, Space Black. Factory sealed with Brazilian invoice and full warranty.' },
  { title: '"Dom Casmurro" first edition (1899)', category: 'Collectibles', price: 45_000, increment: 1_000, endsIn: 96, featured: false,
    description: 'Rare first edition published by H. Garnier. Original binding with expected wear, text block complete.' },
  { title: 'Air Jordan 1 "Chicago" 1985, size 42', category: 'Fashion', price: 30_000, increment: 500, endsIn: 14, featured: false,
    description: 'Original 1985 pair, unworn with original box. Authenticated by a third-party service.' },
  { title: 'Eames Lounge Chair & Ottoman', category: 'Design', price: 27_000, increment: 500, endsIn: 33, featured: false,
    description: 'Licensed Herman Miller production in walnut and black leather. Light patina, structurally perfect.' },
  { title: 'Pokémon Base Set Charizard, PSA 9', category: 'Collectibles', price: 22_000, increment: 250, endsIn: 2, featured: false,
    description: 'Unlimited print, graded Mint 9. Clean slab, excellent centering.' },
  { title: 'Hand-carved jacarandá dining table', category: 'Design', price: 9_500, increment: 100, endsIn: 40, featured: false,
    description: 'Seats eight. Made in the 1960s by a Minas Gerais workshop from legally certified reclaimed wood.' },
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
