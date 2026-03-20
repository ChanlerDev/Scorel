import crypto from "node:crypto";
import { NANOID_LENGTH } from "../../shared/constants.js";

export function generateId(): string {
  return crypto.randomBytes(16).toString("base64url").slice(0, NANOID_LENGTH);
}
