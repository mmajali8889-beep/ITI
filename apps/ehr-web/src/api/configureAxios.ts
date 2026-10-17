import axios from 'axios';

export const API_BASE_URL =
  import.meta.env.VITE_HOSPITAL_API_URL || 'http://localhost:4000/api';

// Authentication is held by the API in an HttpOnly cookie. This keeps the
// Medplum access and refresh tokens out of browser storage and JavaScript.
axios.defaults.withCredentials = true;

// Shared client for every hospital API module.
export const api = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    // A 401 from /auth/* is a failed login or a missing session, which the
    // auth flow handles itself; anywhere else it means the session expired.
    const url: string = error?.config?.url ?? '';
    if (error?.response?.status === 401 && !url.startsWith('/auth/')) {
      window.dispatchEvent(new Event('unitech-auth-required'));
    }
    return Promise.reject(error);
  },
);
