import { SignIn } from '@clerk/nextjs';

export default function SignInPage() {
  return (
    <div className="flex items-center justify-center min-h-[70vh]">
      <SignIn />
    </div>
  );
}
