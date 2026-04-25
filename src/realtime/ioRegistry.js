/** @type {import('socket.io').Server | null} */
let ioRef = null;

export function registerIO(io) {
  ioRef = io;
}

export function getIO() {
  return ioRef;
}
