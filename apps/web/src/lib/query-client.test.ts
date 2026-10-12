import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import { useSessionStore } from '@/stores/session';
import { ME } from '@/test/utils';
import { ApiError } from './api';
import { handleGlobalError, shouldRetry } from './query-client';

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

const err = (status: number) => new ApiError({ status, code: `HTTP_${status}`, title: `T${status}` });

describe('global error policy', () => {
  beforeEach(() => {
    useSessionStore.setState({ user: ME.user, memberships: [], status: 'signedIn' });
    vi.mocked(toast.error).mockClear();
  });

  it('does not retry 4xx, retries 5xx up to twice', () => {
    expect(shouldRetry(0, err(404))).toBe(false);
    expect(shouldRetry(0, err(422))).toBe(false);
    expect(shouldRetry(0, err(503))).toBe(true);
    expect(shouldRetry(2, err(503))).toBe(false);
  });

  it('401 signs the user out without a toast', () => {
    handleGlobalError(err(401));
    expect(useSessionStore.getState().status).toBe('signedOut');
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('5xx shows one toast unless silent', () => {
    handleGlobalError(err(500));
    expect(toast.error).toHaveBeenCalledTimes(1);
    handleGlobalError(err(500), true);
    expect(toast.error).toHaveBeenCalledTimes(1);
  });

  it('other 4xx are left to the screen', () => {
    handleGlobalError(err(409));
    expect(toast.error).not.toHaveBeenCalled();
    expect(useSessionStore.getState().status).toBe('signedIn');
  });
});
