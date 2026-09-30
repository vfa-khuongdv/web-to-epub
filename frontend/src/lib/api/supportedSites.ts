import { SupportedSite } from "../../types";
import { langHeaders } from "./http";

export async function fetchSupportedSites(): Promise<SupportedSite[]> {
  const res = await fetch("/api/supported-sites", { headers: langHeaders() });
  const data = await res.json();
  return data.sites || [];
}
