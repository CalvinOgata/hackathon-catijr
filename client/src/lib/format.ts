export { formatDuration, formatMegabytes, formatMoney } from '@auction/shared';

const longDate = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'long' });

/** In the viewer's own timezone (RF19). */
export const formatDate = (iso: string) => longDate.format(new Date(iso));

const dateTime = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

/** e.g. "14/11/2026, 18:05", in the viewer's own timezone (RF19). */
export const formatDateTime = (iso: string) => dateTime.format(new Date(iso));

export function formatTimeLeft(ms: number): string {
  if (ms <= 0) return 'Encerrado';
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
}

const time = new Intl.DateTimeFormat('pt-BR', { timeStyle: 'short' });

/** e.g. "18:05", in the viewer's own timezone (RF19). */
export const formatTime = (iso: string) => time.format(new Date(iso));

export function formatTimeAgo(iso: string, now = Date.now()): string {
  const seconds = Math.max(0, Math.floor((now - Date.parse(iso)) / 1000));
  if (seconds < 60) return 'agora mesmo';
  if (seconds < 3600) return `há ${Math.floor(seconds / 60)} min`;
  if (seconds < 86_400) return `há ${Math.floor(seconds / 3600)} h`;
  return `há ${Math.floor(seconds / 86_400)} d`;
}

/** Only allow same-site paths, so `?redirect=` can't send users elsewhere. */
export function safeRedirect(target: string | null): string {
  return target?.startsWith('/') && !target.startsWith('//') ? target : '/';
}
