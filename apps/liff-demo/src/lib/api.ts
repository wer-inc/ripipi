import ky from "ky";

const base = import.meta.env.VITE_API_BASE as string;
export const api = ky.create({ prefixUrl: base });