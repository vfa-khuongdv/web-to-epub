import { describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import { hostGuard, originGuard } from "./requestGuard";

function run(mw: (req: Request, res: Response, next: () => void) => void, req: Partial<Request>) {
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response;
  const next = vi.fn();
  mw({ method: "GET", ...req, headers: req.headers ?? {} } as Request, res, next);
  return { next, res };
}

describe("hostGuard", () => {
  it("answers only loopback hosts when bound to loopback", () => {
    expect(run(hostGuard("127.0.0.1"), { headers: { host: "localhost:3100" } }).next).toHaveBeenCalled();
    expect(run(hostGuard("127.0.0.1"), { headers: { host: "127.0.0.1:3100" } }).next).toHaveBeenCalled();
    const bad = run(hostGuard("127.0.0.1"), { headers: { host: "evil.example:3100" } });
    expect(bad.next).not.toHaveBeenCalled();
    expect(bad.res.status).toHaveBeenCalledWith(403);
  });

  it("does not restrict Host when the operator bound every interface", () => {
    expect(run(hostGuard("0.0.0.0"), { headers: { host: "nas.lan:3100" } }).next).toHaveBeenCalled();
  });
});

describe("originGuard", () => {
  it("refuses a cross-origin write, allows same-origin and Origin-less ones", () => {
    const host = "127.0.0.1:3100";
    expect(run(originGuard, { method: "POST", headers: { host, origin: "https://evil.example" } }).next).not.toHaveBeenCalled();
    expect(run(originGuard, { method: "POST", headers: { host, origin: `http://${host}` } }).next).toHaveBeenCalled();
    expect(run(originGuard, { method: "POST", headers: { host } }).next).toHaveBeenCalled();
    expect(run(originGuard, { method: "GET", headers: { host, origin: "https://evil.example" } }).next).toHaveBeenCalled();
  });
});
