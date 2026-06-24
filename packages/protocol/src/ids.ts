export type Brand<TValue, TBrand extends string> = TValue & { readonly __brand: TBrand };

export type SessionId = Brand<string, "SessionId">;
export type EventId = Brand<string, "EventId">;
export type ClientId = Brand<string, "ClientId">;
export type DeviceId = Brand<string, "DeviceId">;
export type ProjectId = Brand<string, "ProjectId">;
export type RequestId = Brand<string, "RequestId">;
export type Seq = Brand<number, "Seq">;

export const protocolVersion = 5 as const;

export const asSessionId = (value: string): SessionId => value as SessionId;
export const asEventId = (value: string): EventId => value as EventId;
export const asClientId = (value: string): ClientId => value as ClientId;
export const asDeviceId = (value: string): DeviceId => value as DeviceId;
export const asProjectId = (value: string): ProjectId => value as ProjectId;
export const asRequestId = (value: string): RequestId => value as RequestId;
export const asSeq = (value: number): Seq => value as Seq;
