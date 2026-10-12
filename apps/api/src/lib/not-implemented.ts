/** Thrown by cross-module stubs until the owning module agent implements them. */
import { AppError } from './errors.js';

export function notImplemented(name: string): AppError {
  return new AppError({ status: 501, code: 'NOT_IMPLEMENTED', title: 'Not implemented', detail: `${name} is not implemented yet.` });
}
