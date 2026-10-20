import type { NextConfig } from "next";
import { publishableKeyProblem } from "./src/lib/clerkKey";

// TF-022: fail the build on a malformed Clerk publishable key instead of
// shipping a sign-in that silently breaks. Unset or empty stays allowed (the
// app renders without auth, as today).
const clerkKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
if (clerkKey) {
  const problem = publishableKeyProblem(clerkKey);
  if (problem) {
    throw new Error(
      `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY is malformed: it ${problem}. ` +
        "Clerk would build its script URL with an empty host and sign-in would break silently. " +
        "Set the variable to the publishable key exactly as Clerk shows it, or unset it to build without auth.",
    );
  }
}

const nextConfig: NextConfig = {
  /* config options here */
};

export default nextConfig;
