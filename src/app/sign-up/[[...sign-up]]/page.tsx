'use client';

import { SignUp } from '@clerk/react';

export default function SignUpPage() {
  return (
    <div className="flex items-center justify-center min-h-[70vh]">
      <SignUp />
    </div>
  );
}
