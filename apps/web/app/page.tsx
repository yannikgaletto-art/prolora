import { redirect } from 'next/navigation';

// Middleware resolves "/" to /onboarding or /publish for signed-in users and
// to /login for everyone else. This runs only if middleware is bypassed.
export default function Home() {
  redirect('/login');
}
