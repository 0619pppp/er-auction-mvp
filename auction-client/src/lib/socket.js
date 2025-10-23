import { io } from "socket.io-client";

const SERVER = "https://er-auction-mvp.onrender.com"; // 예: https://er-auction-server.onrender.com
export const socket = io(SERVER, { transports: ["websocket"] });
