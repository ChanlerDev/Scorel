import type { ClientId, DeviceId } from "@scorel/protocol";
import type { WebSocket } from "ws";

export class RelayPresence {
  readonly #devices = new Map<DeviceId, Set<WebSocket>>();
  readonly #clients = new Map<ClientId, Set<WebSocket>>();

  setDevice(deviceId: DeviceId, socket: WebSocket): void {
    let sockets = this.#devices.get(deviceId);
    if (!sockets) {
      sockets = new Set();
      this.#devices.set(deviceId, sockets);
    }
    sockets.add(socket);
    socket.once("close", () => {
      sockets.delete(socket);
      if (sockets.size === 0) {
        this.#devices.delete(deviceId);
      }
    });
  }

  addClient(clientId: ClientId, socket: WebSocket): void {
    let sockets = this.#clients.get(clientId);
    if (!sockets) {
      sockets = new Set();
      this.#clients.set(clientId, sockets);
    }
    sockets.add(socket);
    socket.once("close", () => {
      sockets.delete(socket);
      if (sockets.size === 0) {
        this.#clients.delete(clientId);
      }
    });
  }

  deviceSocket(deviceId: DeviceId): WebSocket | undefined {
    const sockets = this.#devices.get(deviceId) ?? new Set<WebSocket>();
    return [...sockets].find((socket) => socket.readyState === socket.OPEN);
  }

  clientSockets(clientId: ClientId): WebSocket[] {
    return [...(this.#clients.get(clientId) ?? [])].filter((socket) => socket.readyState === socket.OPEN);
  }

  isDeviceOnline(deviceId: DeviceId): boolean {
    return this.deviceSocket(deviceId) !== undefined;
  }
}
