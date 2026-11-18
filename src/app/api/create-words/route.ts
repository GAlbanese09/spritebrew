export const runtime = 'edge';

import { handleCreateWordsGet } from '@/lib/createWordsRoute';

// GET /api/create-words: the "Adds" words for a Create Sprite card and its
// fine-tune rows, from the private side (G2). The logic is in
// src/lib/createWordsRoute.ts.
export async function GET(request: Request) {
  return handleCreateWordsGet(request);
}
