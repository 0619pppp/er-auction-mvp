import { io } from "socket.io-client";

const defaultURL = import.meta.env.VITE_API_URL || "https://er-auction-server.onrender.com";

export const makeSocket = (baseURL = defaultURL) =>
  io(baseURL, { transports: ["websocket"] });
