import { io } from "socket.io-client";
export const makeSocket = (baseURL = "http://localhost:4000") =>
  io(baseURL, { transports: ["websocket"] });
