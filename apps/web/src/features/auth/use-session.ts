import { useQuery } from '@tanstack/react-query';
import { api, ApiError } from '../../lib/api';
export function useSession() {
  return useQuery({ queryKey: ['session'], queryFn: async () => {
    try { return (await api('/auth/me'))?.user ?? null; }
    catch (error) { if (error instanceof ApiError && error.status === 401) return null; throw error; }
  }, retry: false, staleTime: 0 });
}
