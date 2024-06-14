// public/client.js
const socket = new WebSocket("ws://localhost:5000");

socket.addEventListener("open", () => {
  console.log("Connected to WebSocket server");
  socket.send("Hello from client");
});

socket.addEventListener("message", (event) => {
  console.log("Message from server:", event.data);
});

socket.addEventListener("close", () => {
  console.log("Disconnected from WebSocket server");
});

socket.addEventListener("error", (error) => {
  console.error("WebSocket error:", error);
});
