export const nodeClientEntrypoint = "@scorel/client/node" as const;

export type NodeSocketTransportOptions = {
  path: string;
};

export class NodeSocketTransport {
  readonly path: string;

  constructor(options: NodeSocketTransportOptions) {
    this.path = options.path;
  }
}
