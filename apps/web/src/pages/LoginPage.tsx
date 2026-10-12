/*
 * Sign in. PLACEHOLDER DESIGN: no Figma frame exists for this screen (BUILD-PLAN section 6).
 * Built in the house style; owned by FOUNDATION-WEB.
 */
import { loginRequestSchema, type LoginRequest } from '@growth-desk/contract';
import { zodResolver } from '@hookform/resolvers/zod';
import { Warning } from '@phosphor-icons/react';
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/atoms/Button';
import { Input } from '@/components/atoms/Input';
import { LogoMark } from '@/components/atoms/LogoMark';
import { Field } from '@/components/molecules/Field';
import { isApiError } from '@/lib/api';
import { useLogin } from '@/lib/auth';
import { useSessionStore } from '@/stores/session';


/** Only allow in-app paths as the return target (blocks open redirects). */
function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return '/';
  return raw;
}

function loginErrorText(error: unknown): string {
  if (!isApiError(error)) return 'Could not sign in. Please try again.';
  if (error.code === 'INVALID_CREDENTIALS' || error.status === 401 || error.status === 400) return 'Email or password is wrong.';
  if (error.status === 429) return 'Too many tries. Wait a minute, then try again.';
  if (error.status === 403) return error.detail ?? 'This account cannot sign in.';
  return error.detail ?? error.title;
}

export default function LoginPage() {
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const navigate = useNavigate();
  const status = useSessionStore((s) => s.status);
  const login = useLogin();

  const {
    register,
    handleSubmit,
    setFocus,
    formState: { errors },
  } = useForm<LoginRequest>({ resolver: zodResolver(loginRequestSchema), defaultValues: { email: '', password: '' } });

  React.useEffect(() => {
    document.title = 'Sign in · Growth Desk';
    setFocus('email');
  }, [setFocus]);

  if (status === 'signedIn' && !login.isPending) return <Navigate to={next} replace />;

  const onSubmit = handleSubmit((values) => {
    login.mutate(values, { onSuccess: () => navigate(next, { replace: true }) });
  });

  return (
    <div className="w-full max-w-[400px]">
      <div className="mb-8 flex items-center gap-3 lg:hidden">
        <LogoMark />
        <span className="text-17 font-bold">Growth Desk</span>
      </div>
      <div className="rounded-card border border-hairline bg-surface-card p-8">
        <h1 className="text-2xl font-bold text-ink">Sign in</h1>
        <p className="mt-1 text-sm text-muted">Use your Arus work email.</p>

        {login.isError ? (
          <div
            role="alert"
            className="mt-6 flex items-start gap-2.5 rounded-tile bg-danger-soft px-3.5 py-3 text-13 font-medium text-danger-text"
          >
            <Warning size={18} className="mt-px shrink-0" aria-hidden="true" />
            {loginErrorText(login.error)}
          </div>
        ) : null}

        <form className="mt-6 flex flex-col gap-4" onSubmit={(e) => void onSubmit(e)} noValidate>
          <Field label="Email" error={errors.email} required>
            <Input type="email" autoComplete="username" inputMode="email" {...register('email')} />
          </Field>
          <Field label="Password" error={errors.password} required>
            <Input type="password" autoComplete="current-password" {...register('password')} />
          </Field>
          <Button type="submit" size="lg" loading={login.isPending} className="mt-2 w-full">
            Sign in
          </Button>
        </form>
      </div>
      <p className="mt-6 text-center text-xs text-muted">Forgot your password? Ask your Growth Desk admin to reset it.</p>
    </div>
  );
}
