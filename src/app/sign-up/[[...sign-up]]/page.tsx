'use client';

import { SignUp } from '@clerk/react';

export const runtime = 'edge';

// TODO: George — enable Turnstile in Clerk dashboard.
//   Clerk Dashboard → User & Authentication → Attack Protection →
//   Bot Protection → enable "Cloudflare Turnstile". The hosted <SignUp />
//   component picks it up automatically; no code change needed here.
export default function SignUpPage() {
  return (
    <div className="flex items-center justify-center min-h-[70vh]">
      <SignUp />
    </div>
  );
}
