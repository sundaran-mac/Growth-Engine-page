/** Public runtime config. Only VITE_* values reach the browser; never put secrets here. */
export const env = {
  apiBaseUrl: (import.meta.env.VITE_API_BASE_URL as string | undefined) || '/api/v1',
  isDev: import.meta.env.DEV,
} as const;
