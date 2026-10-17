import { api } from './configureAxios';

export interface AuthSession {
  authenticated: true;
  hospitalId: string;
  expiresAt: string;
  user: {
    id?: string;
    resourceType: string;
    display: string;
    roles: string[];
    permissions: string[];
  };
}

export async function login(input: {
  hospitalId: string;
  username: string;
  password: string;
  remember: boolean;
}): Promise<AuthSession> {
  const response = await api.post<AuthSession>('/auth/login', input);
  return response.data;
}

export async function getSession(): Promise<AuthSession> {
  const response = await api.get<AuthSession>('/auth/session');
  return response.data;
}

export async function logout(): Promise<void> {
  await api.post('/auth/logout');
}
