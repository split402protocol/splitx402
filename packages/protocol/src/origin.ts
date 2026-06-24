export function normalizeOrigin(input: string): string {
  const url = new URL(input);

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("origin must use http or https");
  }
  if (url.username !== "" || url.password !== "") {
    throw new Error("origin must not include credentials");
  }

  const protocol = url.protocol.toLowerCase();
  const hostname = url.hostname.toLowerCase();
  const defaultPort =
    (protocol === "https:" && url.port === "443") ||
    (protocol === "http:" && url.port === "80");
  const port = url.port !== "" && !defaultPort ? `:${url.port}` : "";

  return `${protocol}//${hostname}${port}`;
}

