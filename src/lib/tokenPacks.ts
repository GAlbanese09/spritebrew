export const TOKEN_PACKS = [
  {
    id: 'starter',
    name: 'Starter',
    tokens: 500,
    priceInCents: 499,
    priceDisplay: '$4.99',
    bonus: null as string | null,
    popular: false,
  },
  {
    id: 'creator',
    name: 'Creator',
    tokens: 1800,
    priceInCents: 1499,
    priceDisplay: '$14.99',
    bonus: '+20%',
    popular: true,
  },
  {
    id: 'studio',
    name: 'Studio',
    tokens: 4500,
    priceInCents: 2999,
    priceDisplay: '$29.99',
    bonus: '+50%',
    popular: false,
  },
  {
    id: 'pro',
    name: 'Pro Pack',
    tokens: 15000,
    priceInCents: 7999,
    priceDisplay: '$79.99',
    bonus: '+100%',
    popular: false,
  },
] as const;

export type TokenPackId = typeof TOKEN_PACKS[number]['id'];

export function getTokenPack(id: string) {
  return TOKEN_PACKS.find((p) => p.id === id);
}
