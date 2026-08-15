export type FieldType =
  | "text"
  | "email"
  | "password"
  | "number"
  | "tel"
  | "url"
  | "date"
  | "textarea"
  | "select"
  | "checkbox"
  | "radio"
  | "other";

export interface DetectedField {
  name: string;
  label?: string;
  type: FieldType;
  required: boolean;
  maxLength?: number;
  minLength?: number;
  min?: number;
  max?: number;
  pattern?: string;
  options?: string[]; // for select/radio
}

export interface DetectedModule {
  name: string;
  url: string;
  type: "page" | "form" | "nav";
  fields: DetectedField[];
  formSelector?: string;
  submitSelector?: string;
}

export type TestCategory =
  | "smoke"
  | "boundary"
  | "vulnerability"
  | "stress"
  | "performance"
  | "compatibility"
  | "accessibility"
  | "flow"
  | "story";

export const TEST_CATEGORY_LABELS: Record<TestCategory, string> = {
  smoke: "Smoke",
  boundary: "Boundary value",
  vulnerability: "Vulnerability (security)",
  stress: "Stress / load",
  performance: "Performance",
  compatibility: "Compatibility (viewport)",
  accessibility: "Accessibility",
  flow: "Flows (integration/UAT)",
  story: "Custom test stories",
};

export const ALL_TEST_CATEGORIES = Object.keys(TEST_CATEGORY_LABELS) as TestCategory[];

// Some apps give several distinct pages the same generic <title> (e.g.
// every page titled after the site itself), so a module's name alone
// isn't a reliable identity — two modules with the same name but
// different URLs are different modules. Anywhere user stories are keyed
// by module for lookup/storage, key on this composite instead of name
// alone, or one module's data silently overwrites the other's.
export function moduleKey(name: string, url: string): string {
  return `${name}::${url}`;
}

export type TestType = "positive" | "negative";

export interface GeneratedTestCase {
  category: TestCategory;
  name: string;
  description: string;
  moduleName: string;
  input?: Record<string, string>;
  // For boundary/vulnerability cases run against a specific field
  targetField?: string;
  expectation: string;
  // positive = valid input / normal expected usage; negative = invalid or
  // malicious input, expected to be rejected/handled safely
  testType: TestType;
}

export interface ViewportPreset {
  name: string;
  width: number;
  height: number;
}

export interface ExecutedResult {
  status: "pass" | "fail" | "error";
  severity?: "info" | "low" | "medium" | "high" | "critical";
  actual: string;
  screenshotPath?: string;
  durationMs: number;
}
