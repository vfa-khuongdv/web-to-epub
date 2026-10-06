import crypto from "crypto";
import fs from "fs";
import path from "path";
import type { NextFunction, Request, Response } from "express";

// The API has no login: what keeps other people and other websites out is that it listens
// on loopback only (HOST), answers only to a loopback Host (so DNS rebinding of a hostile
// domain to 127.0.0.1 gets nothing) and refuses cross-origin writes.

export const HOST = process.env.HOST || "127.0.0.1";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export function isLoopbackBind(host: string): boolean {
  return host === "127.0.0.1" || host === "::1" || host === "localhost";
}

function hostnameOf(hostHeader: string): string {
  return hostHeader.replace(/:\d+$/, "").toLowerCase();
}

export function hostGuard(bindHost: string = HOST) {
  return (req: Request, res: Response, next: NextFunction) => {
    // Bound to every interface on purpose (Docker): the operator chose to expose it.
    if (!isLoopbackBind(bindHost)) return next();
    if (LOOPBACK_HOSTS.has(hostnameOf(req.headers.host ?? ""))) return next();
    res.status(403).json({ message: "Forbidden host" });
  };
}

export function originGuard(req: Request, res: Response, next: NextFunction) {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return next();
  const origin = req.headers.origin;
  if (origin) {
    let originHost = "";
    try {
      originHost = new URL(origin).host;
    } catch {
      // unparsable: refused below
    }
    if (originHost !== req.headers.host) {
      res.status(403).json({ message: "Cross-origin request refused" });
      return;
    }
  }
  next();
}

// The page's own inline script (the theme bootstrap) is allowed by hash, so script-src can stay 'self'.
function inlineScriptHashes(publicDir: string): string[] {
  try {
    const html = fs.readFileSync(path.join(publicDir, "index.html"), "utf8");
    return Array.from(html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)).map(
      (match) => `'sha256-${crypto.createHash("sha256").update(match[1]).digest("base64")}'`
    );
  } catch {
    return [];
  }
}

export function securityHeaders(publicDir: string) {
  const csp = [
    "default-src 'self'",
    `script-src 'self' ${inlineScriptHashes(publicDir).join(" ")}`.trim(),
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: http: https:",
    "media-src 'self' blob: data:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "frame-src 'self' blob: about:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
  return (_req: Request, res: Response, next: NextFunction) => {
    res.setHeader("Content-Security-Policy", csp);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    next();
  };
}
