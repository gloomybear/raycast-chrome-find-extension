import {
  List,
  ActionPanel,
  Action,
  Icon,
  showToast,
  Toast,
  Color,
} from "@raycast/api";
import { useState, useEffect, useCallback } from "react";
import { runAppleScript } from "@raycast/utils";
import { readFileSync, existsSync, copyFileSync, unlinkSync } from "fs";
import { homedir, tmpdir } from "os";
import { join } from "path";

// ─── Types ───────────────────────────────────────────────────
interface SearchResult {
  id: string;
  title: string;
  url: string;
  source: "tab" | "bookmark" | "history";
  subtitle?: string;
  favicon?: string;
  // Tab-specific
  windowIndex?: number;
  tabIndex?: number;
  // History-specific
  visitCount?: number;
  lastVisitTime?: number;
}

// ─── Chrome Profile Path ─────────────────────────────────────
function getChromeProfilePath(): string {
  const home = homedir();
  return join(home, "Library", "Application Support", "Google", "Chrome", "Default");
}

// ─── Favicon Helper ──────────────────────────────────────────
function getFaviconUrl(pageUrl: string): string {
  try {
    const parsed = new URL(pageUrl);
    // Use Google's favicon service — fast, cached, and works for any domain
    return `https://www.google.com/s2/favicons?sz=64&domain=${parsed.hostname}`;
  } catch {
    return "";
  }
}

// ─── Tab Fetching via AppleScript ────────────────────────────
async function getChromeTabs(): Promise<SearchResult[]> {
  try {
    const script = `
      set output to ""
      tell application "Google Chrome"
        set windowCount to count of windows
        repeat with w from 1 to windowCount
          set tabCount to count of tabs of window w
          repeat with t from 1 to tabCount
            set tabTitle to title of tab t of window w
            set tabURL to URL of tab t of window w
            set output to output & w & "|||" & t & "|||" & tabTitle & "|||" & tabURL & "\\n"
          end repeat
        end repeat
      end tell
      return output
    `;

    const result = await runAppleScript(script);
    if (!result || result.trim() === "") return [];

    const tabs: SearchResult[] = [];
    const lines = result.split("\n").filter((line) => line.trim() !== "");

    for (const line of lines) {
      const parts = line.split("|||");
      if (parts.length >= 4) {
        const windowIndex = parseInt(parts[0]);
        const tabIndex = parseInt(parts[1]);
        const title = parts[2] || "Untitled";
        const url = parts[3] || "";

        tabs.push({
          id: `tab-${windowIndex}-${tabIndex}`,
          title,
          url,
          source: "tab",
          subtitle: url,
          favicon: getFaviconUrl(url),
          windowIndex,
          tabIndex,
        });
      }
    }

    return tabs;
  } catch (error) {
    console.error("Error fetching Chrome tabs:", error);
    return [];
  }
}

// ─── Switch to Tab via AppleScript ───────────────────────────
async function switchToTab(windowIndex: number, tabIndex: number): Promise<void> {
  const script = `
    tell application "Google Chrome"
      set active tab index of window ${windowIndex} to ${tabIndex}
      set index of window ${windowIndex} to 1
      activate
    end tell
  `;
  await runAppleScript(script);
}

// ─── Open URL in Chrome ──────────────────────────────────────
async function openUrlInChrome(url: string): Promise<void> {
  const script = `
    tell application "Google Chrome"
      open location "${url.replace(/"/g, '\\"')}"
      activate
    end tell
  `;
  await runAppleScript(script);
}

// ─── Bookmark Parsing ────────────────────────────────────────
interface ChromeBookmarkNode {
  type?: string;
  name?: string;
  url?: string;
  children?: ChromeBookmarkNode[];
  [key: string]: unknown;
}

function extractBookmarks(node: ChromeBookmarkNode, results: SearchResult[], path = ""): void {
  if (node.type === "url" && node.url && node.name) {
    results.push({
      id: `bookmark-${results.length}`,
      title: node.name,
      url: node.url,
      source: "bookmark",
      subtitle: path ? `${path} › ${node.url}` : node.url,
      favicon: getFaviconUrl(node.url),
    });
  }

  if (node.children) {
    const folderName = path ? `${path} › ${node.name || ""}` : (node.name || "");
    for (const child of node.children) {
      extractBookmarks(child, results, folderName);
    }
  }

  // Handle roots structure
  for (const key of ["bookmark_bar", "other", "synced"]) {
    if (key in node && typeof node[key] === "object" && node[key] !== null) {
      extractBookmarks(node[key] as ChromeBookmarkNode, results, path);
    }
  }
}

function getChromeBookmarks(): SearchResult[] {
  try {
    const bookmarksPath = join(getChromeProfilePath(), "Bookmarks");
    if (!existsSync(bookmarksPath)) return [];

    const data = JSON.parse(readFileSync(bookmarksPath, "utf-8"));
    const results: SearchResult[] = [];
    if (data.roots) {
      extractBookmarks({ ...data.roots } as ChromeBookmarkNode, results);
    }
    return results;
  } catch (error) {
    console.error("Error reading bookmarks:", error);
    return [];
  }
}

// ─── History via SQLite ──────────────────────────────────────
function getChromeHistory(limit = 200): SearchResult[] {
  try {
    const historyPath = join(getChromeProfilePath(), "History");
    if (!existsSync(historyPath)) return [];

    // Chrome locks the History database, so copy it first
    const tempPath = join(tmpdir(), `chrome-history-raycast-${Date.now()}.db`);

    try {
      copyFileSync(historyPath, tempPath);
    } catch {
      console.error("Could not copy History database");
      return [];
    }

    let results: SearchResult[] = [];

    try {
      const { execSync } = require("child_process");
      const output = execSync(
        `sqlite3 -separator '|||' "${tempPath}" "SELECT url, title, visit_count FROM urls ORDER BY last_visit_time DESC LIMIT ${limit};"`,
        { encoding: "utf-8", timeout: 5000 }
      );

      results = output
        .split("\n")
        .filter((line: string) => line.trim())
        .map((line: string, index: number) => {
          const parts = line.split("|||");
          return {
            id: `history-${index}`,
            title: parts[1] || parts[0] || "Untitled",
            url: parts[0] || "",
            source: "history" as const,
            subtitle: parts[0] || "",
            favicon: getFaviconUrl(parts[0] || ""),
            visitCount: parseInt(parts[2]) || 0,
          };
        });
    } catch (error) {
      console.error("Error querying history database:", error);
    }

    // Clean up temp file
    try {
      unlinkSync(tempPath);
    } catch {
      // ignore cleanup errors
    }

    return results;
  } catch (error) {
    console.error("Error reading history:", error);
    return [];
  }
}

// ─── Source Icon & Tag ───────────────────────────────────────
function getSourceIcon(source: "tab" | "bookmark" | "history"): Icon {
  switch (source) {
    case "tab":
      return Icon.Globe;
    case "bookmark":
      return Icon.Bookmark;
    case "history":
      return Icon.Clock;
  }
}

function getSourceTag(source: "tab" | "bookmark" | "history"): { value: string; color: Color } {
  switch (source) {
    case "tab":
      return { value: "Tab", color: Color.Green };
    case "bookmark":
      return { value: "Bookmark", color: Color.Blue };
    case "history":
      return { value: "History", color: Color.Orange };
  }
}

// ─── Deduplication ───────────────────────────────────────────
function deduplicateResults(results: SearchResult[]): SearchResult[] {
  const seen = new Map<string, SearchResult>();

  // Priority: tab > bookmark > history
  const priority = { tab: 0, bookmark: 1, history: 2 };

  for (const result of results) {
    // Normalize URL for deduplication (remove trailing slashes, fragments)
    let normalizedUrl = result.url;
    try {
      const parsed = new URL(result.url);
      normalizedUrl = `${parsed.protocol}//${parsed.host}${parsed.pathname}`.replace(/\/+$/, "");
    } catch {
      // keep as-is if URL parsing fails
    }

    const existing = seen.get(normalizedUrl);
    if (!existing || priority[result.source] < priority[existing.source]) {
      seen.set(normalizedUrl, result);
    }
  }

  return Array.from(seen.values());
}

// ─── Main Command ────────────────────────────────────────────
export default function Command() {
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      // Load all sources in parallel
      const [tabs, bookmarks, history] = await Promise.all([
        getChromeTabs(),
        Promise.resolve(getChromeBookmarks()),
        Promise.resolve(getChromeHistory(500)),
      ]);

      // Combine and deduplicate (tabs have highest priority)
      const combined = [...tabs, ...bookmarks, ...history];
      const deduplicated = deduplicateResults(combined);

      setResults(deduplicated);
    } catch (error) {
      console.error("Error loading data:", error);
      showToast({
        style: Toast.Style.Failure,
        title: "Failed to load Chrome data",
        message: String(error),
      });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  return (
    <List
      isLoading={isLoading}
      searchBarPlaceholder="Search tabs, bookmarks, and history..."
      throttle
    >
      <List.Section title="Open Tabs" subtitle={`${results.filter((r) => r.source === "tab").length} tabs`}>
        {results
          .filter((r) => r.source === "tab")
          .map((result) => (
            <ResultItem
              key={result.id}
              result={result}
              onTabSwitch={switchToTab}
              onOpenUrl={openUrlInChrome}
              onRefresh={loadData}
            />
          ))}
      </List.Section>

      <List.Section title="Bookmarks" subtitle={`${results.filter((r) => r.source === "bookmark").length} bookmarks`}>
        {results
          .filter((r) => r.source === "bookmark")
          .map((result) => (
            <ResultItem
              key={result.id}
              result={result}
              onTabSwitch={switchToTab}
              onOpenUrl={openUrlInChrome}
              onRefresh={loadData}
            />
          ))}
      </List.Section>

      <List.Section title="History" subtitle={`${results.filter((r) => r.source === "history").length} entries`}>
        {results
          .filter((r) => r.source === "history")
          .map((result) => (
            <ResultItem
              key={result.id}
              result={result}
              onTabSwitch={switchToTab}
              onOpenUrl={openUrlInChrome}
              onRefresh={loadData}
            />
          ))}
      </List.Section>
    </List>
  );
}

// ─── Result List Item ────────────────────────────────────────
function ResultItem({
  result,
  onTabSwitch,
  onOpenUrl,
  onRefresh,
}: {
  result: SearchResult;
  onTabSwitch: (windowIndex: number, tabIndex: number) => Promise<void>;
  onOpenUrl: (url: string) => Promise<void>;
  onRefresh: () => Promise<void>;
}) {
  const tag = getSourceTag(result.source);

  // Extract domain for subtitle
  let domain = result.url;
  try {
    domain = new URL(result.url).hostname;
  } catch {
    // keep as-is
  }

  // Determine icon: use favicon if available, fall back to source icon
  const icon = result.favicon
    ? { source: result.favicon, fallback: getSourceIcon(result.source) }
    : getSourceIcon(result.source);

  return (
    <List.Item
      title={result.title || "Untitled"}
      subtitle={domain}
      icon={icon}
      accessories={[{ tag }]}
      keywords={[result.url, result.title, domain].filter(Boolean)}
      actions={
        <ActionPanel>
          <ActionPanel.Section>
            {result.source === "tab" && result.windowIndex && result.tabIndex ? (
              <Action
                title="Switch to Tab"
                icon={Icon.Globe}
                onAction={async () => {
                  await onTabSwitch(result.windowIndex!, result.tabIndex!);
                  showToast({ style: Toast.Style.Success, title: `Switched to: ${result.title}` });
                }}
              />
            ) : (
              <Action
                title="Open in Chrome"
                icon={Icon.Globe}
                onAction={async () => {
                  await onOpenUrl(result.url);
                  showToast({ style: Toast.Style.Success, title: `Opening: ${result.title}` });
                }}
              />
            )}
            <Action.OpenInBrowser title="Open in Default Browser" url={result.url} />
            <Action.CopyToClipboard title="Copy URL" content={result.url} shortcut={{ modifiers: ["cmd"], key: "c" }} />
          </ActionPanel.Section>
          <ActionPanel.Section>
            <Action
              title="Refresh Data"
              icon={Icon.ArrowClockwise}
              shortcut={{ modifiers: ["cmd"], key: "r" }}
              onAction={onRefresh}
            />
          </ActionPanel.Section>
        </ActionPanel>
      }
    />
  );
}
