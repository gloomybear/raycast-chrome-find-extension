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
import {
  SearchResult,
  getChromeProfilePath,
  getChromeBookmarks,
  getChromeHistory,
  deduplicateResults,
  parseTabOutput,
  extractDomain,
} from "./chrome-utils";

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

function getSourceTag(source: "tab" | "bookmark" | "history"): {
  value: string;
  color: Color;
} {
  switch (source) {
    case "tab":
      return { value: "Tab", color: Color.Green };
    case "bookmark":
      return { value: "Bookmark", color: Color.Blue };
    case "history":
      return { value: "History", color: Color.Orange };
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
    return parseTabOutput(result);
  } catch (error) {
    console.error("Error fetching Chrome tabs:", error);
    return [];
  }
}

// ─── Switch to Tab via AppleScript ───────────────────────────
async function switchToTab(
  windowIndex: number,
  tabIndex: number,
): Promise<void> {
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

// ─── Main Command ────────────────────────────────────────────
export default function Command() {
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const profilePath = getChromeProfilePath();

      // Load all sources in parallel
      const [tabs, bookmarks, history] = await Promise.all([
        getChromeTabs(),
        Promise.resolve(getChromeBookmarks(profilePath)),
        Promise.resolve(getChromeHistory(500, profilePath)),
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
      <List.Section
        title="Open Tabs"
        subtitle={`${results.filter((r) => r.source === "tab").length} tabs`}
      >
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

      <List.Section
        title="Bookmarks"
        subtitle={`${results.filter((r) => r.source === "bookmark").length} bookmarks`}
      >
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

      <List.Section
        title="History"
        subtitle={`${results.filter((r) => r.source === "history").length} entries`}
      >
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
  const domain = extractDomain(result.url);

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
            {result.source === "tab" &&
            result.windowIndex &&
            result.tabIndex ? (
              <Action
                title="Switch to Tab"
                icon={Icon.Globe}
                onAction={async () => {
                  await onTabSwitch(result.windowIndex!, result.tabIndex!);
                  showToast({
                    style: Toast.Style.Success,
                    title: `Switched to: ${result.title}`,
                  });
                }}
              />
            ) : (
              <Action
                title="Open in Chrome"
                icon={Icon.Globe}
                onAction={async () => {
                  await onOpenUrl(result.url);
                  showToast({
                    style: Toast.Style.Success,
                    title: `Opening: ${result.title}`,
                  });
                }}
              />
            )}
            <Action.OpenInBrowser
              title="Open in Default Browser"
              url={result.url}
            />
            <Action.CopyToClipboard
              title="Copy URL"
              content={result.url}
              shortcut={{ modifiers: ["cmd"], key: "c" }}
            />
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
