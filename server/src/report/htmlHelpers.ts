export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function statusBadge(status: string): string {
  const color = status === "pass" ? "#1a7f37" : status === "fail" ? "#cf222e" : "#9a6700";
  return `<span style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:12px;font-weight:600;color:#fff;background:${color}">${status.toUpperCase()}</span>`;
}

export function testTypeBadge(testType: string): string {
  const positive = testType === "positive";
  const color = positive ? "#0969da" : "#8250df";
  return `<span style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:12px;font-weight:600;color:#fff;background:${color}">${positive ? "POSITIVE" : "NEGATIVE"}</span>`;
}
