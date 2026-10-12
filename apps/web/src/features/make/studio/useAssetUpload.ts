import { useQueryClient } from '@tanstack/react-query';
import * as React from 'react';
import type { MakeAsset, CreateUploadInput } from '@growth-desk/contract';
import { isApiError } from '@/lib/api';
import { makeKeys } from '../api';
import { runUpload, UploadAbortedError, type UploadDeps } from './upload';

export type UploadState =
  | { status: 'idle' }
  | { status: 'uploading'; progress: number; fileName: string }
  | { status: 'done'; asset: MakeAsset }
  | { status: 'cancelled' }
  | { status: 'error'; message: string; code: string | null };

/** One upload at a time per dialog. Keeps progress, supports cancel, refreshes the asset list. */
export function useAssetUpload(briefId: string, deps?: Partial<UploadDeps>) {
  const qc = useQueryClient();
  const [state, setState] = React.useState<UploadState>({ status: 'idle' });
  const controllerRef = React.useRef<AbortController | null>(null);

  React.useEffect(() => () => controllerRef.current?.abort(), []);

  const start = React.useCallback(
    async (input: CreateUploadInput, file: File): Promise<MakeAsset | null> => {
      const controller = new AbortController();
      controllerRef.current = controller;
      setState({ status: 'uploading', progress: 0, fileName: file.name });
      try {
        const asset = await runUpload(input, file, {
          signal: controller.signal,
          ...(deps ? { deps } : {}),
          onCreated: () => void qc.invalidateQueries({ queryKey: makeKeys.assets(briefId) }),
          onProgress: (progress) =>
            setState((s) => (s.status === 'uploading' ? { ...s, progress } : s)),
        });
        setState({ status: 'done', asset });
        return asset;
      } catch (err) {
        if (err instanceof UploadAbortedError || controller.signal.aborted) {
          setState({ status: 'cancelled' });
        } else {
          setState({
            status: 'error',
            message: isApiError(err)
              ? (err.detail ?? err.title)
              : err instanceof Error
                ? err.message
                : 'The upload failed.',
            code: isApiError(err) ? err.code : null,
          });
        }
        return null;
      } finally {
        controllerRef.current = null;
        void qc.invalidateQueries({ queryKey: makeKeys.assets(briefId) });
      }
    },
    [briefId, deps, qc],
  );

  const cancel = React.useCallback(() => controllerRef.current?.abort(), []);
  const reset = React.useCallback(() => setState({ status: 'idle' }), []);

  return { state, start, cancel, reset };
}
