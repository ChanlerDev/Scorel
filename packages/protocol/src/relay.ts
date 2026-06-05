import type { ClientId, DeviceId, RequestId } from "./ids.js";
import type { ClientMessage, DaemonMessage } from "./wire.js";

export type RelayDeviceRecord = {
  deviceId: DeviceId;
  label?: string;
  publicKey?: string;
  createdAt: number;
  updatedAt: number;
};

export type RelayClientRecord = {
  clientId: ClientId;
  label?: string;
  publicKey?: string;
  createdAt: number;
  updatedAt: number;
};

export type RelayBindingRecord = {
  deviceId: DeviceId;
  clientId: ClientId;
  createdAt: number;
};

export type RelayAuthorizedDevice = RelayDeviceRecord & {
  online: boolean;
};

export type RelayEntryFrame =
  | { type: "entry_hello"; clientId: ClientId; label?: string; publicKey?: string }
  | { type: "create_pair_session"; requestId: RequestId; clientId?: ClientId }
  | { type: "entry_to_device"; deviceId: DeviceId; payload: ClientMessage }
  | { type: "list_authorized_devices"; requestId: RequestId };

export type RelayHostFrame =
  | { type: "host_hello"; deviceId: DeviceId; label?: string; publicKey?: string }
  | { type: "redeem_pair"; requestId: RequestId; pairCode: string; deviceId: DeviceId }
  | { type: "host_to_entry"; clientId: ClientId; payload: DaemonMessage };

export type RelayErrorCode =
  | "invalid_request"
  | "not_announced"
  | "pair_not_found"
  | "pair_expired"
  | "unauthorized"
  | "device_offline"
  | "client_offline"
  | "internal_error";

export type RelayResponse =
  | {
      type: "relay_response";
      requestId: RequestId;
      ok: true;
      data:
        | { pairCode: string; expiresAt: number }
        | { clientId: ClientId }
        | { devices: RelayAuthorizedDevice[] };
    }
  | {
      type: "relay_error";
      requestId?: RequestId;
      ok: false;
      code: RelayErrorCode;
      message: string;
    };

export type RelayToHostFrame = {
  type: "relay_to_host";
  clientId: ClientId;
  payload: ClientMessage;
};

export type RelayToEntryFrame = {
  type: "device_to_entry";
  deviceId: DeviceId;
  payload: DaemonMessage;
};

export type RelayServerFrame = RelayResponse | RelayToHostFrame | RelayToEntryFrame;
