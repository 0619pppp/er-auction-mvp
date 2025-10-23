import { io } from "socket.io-client";

// Render 서버 주소로 교체
const SERVER = "https://er-auction-mvp.onrender.com"; // 예: https://er-auction-mvp.onrender.com
export const socket = io(SERVER, { transports: ["websocket"] });
