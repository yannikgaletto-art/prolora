import type { Metadata } from 'next';
import Link from 'next/link';
import { RegisterForm } from './RegisterForm';

export const metadata: Metadata = { title: 'Create account — Prolora' };

export default function RegisterPage() {
  return (
    <>
      <RegisterForm />
      <p className="mt-6 text-center text-sm text-gray-500">
        Already have an account?{' '}
        <Link href="/login" className="font-medium text-primary-700 hover:text-primary-800">
          Sign in
        </Link>
      </p>
    </>
  );
}
