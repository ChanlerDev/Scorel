import { describe, expect, it, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DeviceForm } from "./device-form";

afterEach(() => cleanup());

describe("DeviceForm", () => {
  it("renders all fields with submit and cancel buttons", () => {
    render(
      <DeviceForm
        submitLabel="Save"
        onSubmit={() => {}}
        onCancel={() => {}}
      />
    );
    const fields = [
      screen.getByLabelText("Name"),
      screen.getByLabelText("Link"),
      screen.getByLabelText("Token"),
    ];
    for (const field of fields) {
      expect(field).toBeTruthy();
      expect(field.className).toContain("outline-none");
      expect(field.className).toContain("focus-visible:border-border-strong");
    }
    expect((screen.getByText("Save") as HTMLButtonElement).type).toBe("submit");
    expect(screen.getByText("Cancel")).toBeTruthy();
  });

  it("disables submit while form is invalid", () => {
    render(
      <DeviceForm submitLabel="Save" onSubmit={() => {}} onCancel={() => {}} />
    );
    const submit = screen.getByText("Save") as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
  });

  it("enables submit + calls onSubmit with values when valid", () => {
    const onSubmit = vi.fn();
    render(
      <DeviceForm submitLabel="Save" onSubmit={onSubmit} onCancel={() => {}} />
    );
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Home" } });
    fireEvent.change(screen.getByLabelText("Link"), { target: { value: "wss://localhost:9876" } });
    fireEvent.change(screen.getByLabelText("Token"), { target: { value: "abc" } });
    const submit = screen.getByText("Save") as HTMLButtonElement;
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0]?.[0]).toEqual({
      name: "Home",
      link: "wss://localhost:9876",
      token: "abc",
    });
  });

  it("surfaces link validation error on blur", () => {
    render(
      <DeviceForm submitLabel="Save" onSubmit={() => {}} onCancel={() => {}} />
    );
    const link = screen.getByLabelText("Link") as HTMLInputElement;
    fireEvent.change(link, { target: { value: "http://nope" } });
    fireEvent.blur(link);
    expect(screen.getByText(/wss:\/\//)).toBeTruthy();
  });

  it("renders password input for token", () => {
    render(
      <DeviceForm submitLabel="Save" onSubmit={() => {}} onCancel={() => {}} />
    );
    const token = screen.getByLabelText("Token") as HTMLInputElement;
    expect(token.type).toBe("password");
  });

  it("preloads initial values for edit mode", () => {
    render(
      <DeviceForm
        submitLabel="Save"
        initial={{ name: "A", link: "wss://h", token: "t" }}
        onSubmit={() => {}}
        onCancel={() => {}}
      />
    );
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("A");
    expect((screen.getByLabelText("Link") as HTMLInputElement).value).toBe("wss://h");
    expect((screen.getByLabelText("Token") as HTMLInputElement).value).toBe("t");
  });
});
