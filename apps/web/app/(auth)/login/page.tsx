import type { Metadata } from 'next';
import Link from 'next/link';
import { LoginForm } from './LoginForm';

export const metadata: Metadata = { title: 'Sign in — Prolora' };

export default function LoginPage() {
  return (
    <>
      <LoginForm />
      <p className="mt-6 text-center text-sm text-gray-500">
        No account?{' '}
        <Link href="/register" className="font-medium text-primary-700 hover:text-primary-800">
          Create one
        </Link>
      </p>
    </>
  );
}
