import ky from "ky";

const base = import.meta.env.VITE_API_URL as string;

export const api = ky.create({ 
  prefixUrl: base,
  hooks: {
    beforeRequest: [
      request => {
        const token = localStorage.getItem('admin_token');
        if (token) {
          request.headers.set('Authorization', `Bearer ${token}`);
        }
      }
    ]
  }
});