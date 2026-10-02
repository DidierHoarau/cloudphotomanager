// Builds the WebSocket URL for the sync channel from the API base URL.
// Handles relative bases (same-origin web app) and absolute ones. The
// handshake is authenticated by the httpOnly session cookie; no token ever
// goes into the URL.
export function buildSyncWebSocketUrl(serverUrl: string): string {
  let url: string = serverUrl;
  if (url.startsWith("/")) {
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    url = `${proto}://${window.location.host}${url}`;
  } else {
    url = url.replace(/^https:\/\//, "wss://").replace(/^http:\/\//, "ws://");
  }
  return `${url}/sync/ws`;
}
