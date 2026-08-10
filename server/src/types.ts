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

export interface GeneratedTestCase {
  category: "smoke" | "boundary" | "vulnerability";
  name: string;
  description: string;
  moduleName: string;
  input?: Record<string, string>;
  // For boundary/vulnerability cases run against a specific field
  targetField?: string;
  expectation: string;
}

export interface ExecutedResult {
  status: "pass" | "fail" | "error";
  severity?: "info" | "low" | "medium" | "high" | "critical";
  actual: string;
  screenshotPath?: string;
  durationMs: number;
}
