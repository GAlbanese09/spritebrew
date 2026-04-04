'use client';

import { SignIn } from '@clerk/react';

export const runtime = 'edge';

export default function SignInPage() {
  return (
    <div className="flex items-center justify-center min-h-[70vh]">
      <SignIn />
    </div>
  );
}
