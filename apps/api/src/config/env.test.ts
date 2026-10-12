import { describe, expect, it } from 'vitest';
import { EnvError, parseEnv } from './env.js';

const HEX_KEY = 'a'.repeat(64);
const prodBase = {
  NODE_ENV: 'production',
  WEB_ORIGIN: 'https://desk.humini.app',
  PUBLIC_API_URL: 'https://desk.humini.app',
  DATABASE_URL: 'postgres://u:p@db:5432/growth_desk',
  SESSION_SECRET: 's'.repeat(40),
  ENCRYPTION_KEY: HEX_KEY,
  STORAGE_DRIVER: 'r2',
  R2_ACCOUNT_ID: 'acc',
  R2_ACCESS_KEY_ID: 'id',
  R2_SECRET_ACCESS_KEY: 'secret',
  R2_BUCKET: 'bucket',
  ANTHROPIC_API_KEY: 'key',
  META_APP_ID: 'x',
  META_APP_SECRET: 'x',
  META_WEBHOOK_VERIFY_TOKEN: 'x',
  GOOGLE_CLIENT_ID: 'x',
  GOOGLE_CLIENT_SECRET: 'x',
  LINKEDIN_CLIENT_ID: 'x',
  LINKEDIN_CLIENT_SECRET: 'x',
  GITHUB_TOKEN: 'x',
};

describe('parseEnv', () => {
  it('runs with an empty env in development, with features off and dev secrets', () => {
    const { env, warnings } = parseEnv({ NODE_ENV: 'development' });
    expect(env.port).toBe(4000);
    expect(env.databaseUrl).toContain('localhost:5433/growth_desk');
    expect(env.databaseUrlTest).toContain('growth_desk_test');
    expect(env.webOrigins).toEqual(['http://localhost:5173', 'http://localhost:8080']);
    expect(env.encryptionKey).toHaveLength(32);
    expect(env.sessionSecret.length).toBeGreaterThanOrEqual(32);
    expect(env.features).toMatchObject({ claude: false, meta: false, storage: true });
    expect(env.storage?.driver).toBe('minio');
    expect(env.seedUserPassword).toBe('growthdesk-dev');
    expect(env.anthropicModel).toBe('claude-opus-5-5');
    expect(warnings.some((w) => w.includes('SESSION_SECRET'))).toBe(true);
  });

  it('gives the same dev secrets on every parse (API and worker agree)', () => {
    const a = parseEnv({ NODE_ENV: 'development' }).env;
    const b = parseEnv({ NODE_ENV: 'development' }).env;
    expect(a.encryptionKey.equals(b.encryptionKey)).toBe(true);
    expect(a.sessionSecret).toBe(b.sessionSecret);
  });

  it('treats empty strings as not set', () => {
    const { env } = parseEnv({
      NODE_ENV: 'development',
      PORT: '',
      ANTHROPIC_API_KEY: '  ',
      STORAGE_DRIVER: '',
    });
    expect(env.port).toBe(4000);
    expect(env.anthropic).toBeNull();
    expect(env.storage?.driver).toBe('minio');
  });

  it('turns a feature on when all its keys are set', () => {
    const { env } = parseEnv({
      NODE_ENV: 'development',
      ANTHROPIC_API_KEY: 'k',
      ANTHROPIC_MODEL: 'claude-sonnet-5-5',
    });
    expect(env.features.claude).toBe(true);
    expect(env.anthropic).toMatchObject({ apiKey: 'k', model: 'claude-sonnet-5-5' });
  });

  it('accepts a complete production env', () => {
    const { env } = parseEnv(prodBase);
    expect(env.isProduction).toBe(true);
    expect(env.cookieSecure).toBe(true);
    expect(env.storage).toMatchObject({
      driver: 'r2',
      endpoint: 'https://acc.r2.cloudflarestorage.com',
      bucket: 'bucket',
    });
  });

  it('lists every missing secret in production', () => {
    try {
      parseEnv({ NODE_ENV: 'production' });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(EnvError);
      const problems = (err as EnvError).problems.join('\n');
      for (const name of [
        'SESSION_SECRET',
        'ENCRYPTION_KEY',
        'DATABASE_URL',
        'STORAGE_DRIVER',
        'ANTHROPIC_API_KEY',
        'META_APP_ID',
      ]) {
        expect(problems).toContain(name);
      }
    }
  });

  it('rejects a short session secret and a bad encryption key', () => {
    expect(() => parseEnv({ ...prodBase, SESSION_SECRET: 'short' })).toThrow(/SESSION_SECRET/);
    expect(() => parseEnv({ ...prodBase, ENCRYPTION_KEY: 'not-a-key' })).toThrow(/ENCRYPTION_KEY/);
  });

  it('rejects a bad value type', () => {
    expect(() => parseEnv({ NODE_ENV: 'staging' })).toThrow(EnvError);
    expect(() => parseEnv({ NODE_ENV: 'development', PORT: 'abc' })).toThrow(EnvError);
  });
});
