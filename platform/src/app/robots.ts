import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/me", "/login", "/register", "/dev", "/healthz"] }],
  };
}
