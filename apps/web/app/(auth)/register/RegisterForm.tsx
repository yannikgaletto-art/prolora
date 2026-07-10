'use client';

import { useState } from 'react';
import { z } from 'zod';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { Button } from '@/app/components/Button';
import { Input } from '@/app/components/Input';

const credentialsSchema = z.object({
  email: z.string().email('Enter a valid email address.'),
  password: z.string().min(8, 'Password must be at least 8 characters.'),
});

type FieldErrors = Partial<Record<'email' | 'password', string>>;

export function RegisterForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirmationRequired, setConfirmationRequired] = useState(false);

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);

    const parsed = credentialsSchema.safeParse({ email, password });
    if (!parsed.success) {
      const errors: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0];
        if (field === 'email' || field === 'password') errors[field] = issue.message;
      }
      setFieldErrors(errors);
      return;
    }
    setFieldErrors({});
    setSubmitting(true);

    const { data, error } = await createSupabaseBrowserClient().auth.signUp(parsed.data);
    if (error) {
      setFormError(error.message);
      setSubmitting(false);
      return;
    }

    // With email confirmation enabled Supabase returns a user but no session.
    // There is nothing to redirect to until the address is verified.
    if (!data.session) {
      setConfirmationRequired(true);
      setSubmitting(false);
      return;
    }

    // The workspace is provisioned by middleware on this first request.
    window.location.assign('/');
  };

  if (confirmationRequired) {
    return (
      <div className="space-y-2">
        <h1 className="text-lg font-semibold text-gray-900">Check your inbox</h1>
        <p className="text-sm text-gray-500">
          We sent a confirmation link to <span className="font-medium text-gray-900">{email}</span>.
          Open it to activate your account, then sign in.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-gray-900">Create your account</h1>
        <p className="mt-1 text-sm text-gray-500">Your workspace is set up automatically.</p>
      </div>

      <Input
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        error={fieldErrors.email}
        required
      />
      <Input
        label="Password"
        name="password"
        type="password"
        autoComplete="new-password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        error={fieldErrors.password}
        hint="At least 8 characters."
        required
      />

      {formError && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {formError}
        </p>
      )}

      <Button type="submit" loading={submitting} className="w-full">
        Create account
      </Button>
    </form>
  );
}
