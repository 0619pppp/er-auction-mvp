import { io } from "socket.io-client";
export const makeSocket = (baseURL = "https://er-auction.onrender.com") =>
  io(baseURL, { transports: ["websocket"] });
