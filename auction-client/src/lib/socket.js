import { io } from "socket.io-client";
const defaultURL = "https://er-auction-mvp.vercel.app"; // 예: https://er-auction.onrender.com
export const makeSocket = (baseURL = defaultURL) =>
  io(baseURL, { transports: ["websocket"] });