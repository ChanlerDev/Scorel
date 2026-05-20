export default {
  id: "scorel-smoke-extension",
  name: "Scorel Smoke Extension",
  version: "0.0.0",
  tools() {
    return [
      {
        name: "scorel_extension_smoke_marker",
        label: "Extension smoke marker",
        description: "Return a fixed marker for Scorel extension smoke tests.",
        parameters: {
          type: "object",
          properties: {},
          additionalProperties: false
        },
        execute() {
          return {
            content: [{ type: "text", text: "scorel-extension-smoke-ok" }]
          };
        }
      }
    ];
  },
  commands() {
    return {
      "extension-smoke": {
        description: "Print a fixed marker for Scorel extension smoke tests.",
        run() {
          return "scorel-extension-command-ok";
        }
      }
    };
  },
  onEvent(event) {
    if (event.type === "runtime_end" && event.error) {
      throw new Error("intentional isolated smoke listener failure");
    }
  },
  hooks() {
    return {
      buildContext({ context }) {
        return context;
      }
    };
  }
};
