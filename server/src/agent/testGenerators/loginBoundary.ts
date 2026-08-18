import { DetectedModule, GeneratedTestCase } from "../../types.js";
import { looksLikeLoginForm } from "../crawler.js";

export interface LoginCredentials {
  username: string;
  password: string;
}

// Business-rule BVA checks specific to a username/password login flow
// (single-step or the two-step "username -> Proceed -> password appears"
// pattern also handled by crawler.ts's attemptLogin). These codify findings
// from testing a real production login screen: an asymmetric trim rule
// (username trimmed, password taken literally), password masking, and
// case-insensitive username matching, alongside the standard
// empty/whitespace/SQLi/XSS/unicode checks.
//
// Real credentials are required: several of these checks (trim rule, case
// sensitivity, masking) can only be verified by actually reaching and
// passing the password step, which the generic per-field boundary/
// vulnerability generators can't do because they fill every field in one
// shot rather than driving a multi-step wizard.
export function generateLoginBoundaryTests(
  modules: DetectedModule[],
  credentials?: LoginCredentials,
): GeneratedTestCase[] {
  if (!credentials?.username || !credentials?.password) return [];

  const cases: GeneratedTestCase[] = [];
  const loginModules = modules.filter((m) => m.type === "form" && looksLikeLoginForm(m.fields));

  for (const module of loginModules) {
    const push = (
      name: string,
      expectation: string,
      testType: GeneratedTestCase["testType"],
      input: Record<string, string>,
    ) => {
      cases.push({
        category: "loginBoundary",
        name: `${module.name}: ${name}`,
        description: `Login boundary check: ${name}.`,
        moduleName: module.name,
        input,
        expectation,
        testType,
      });
    };

    push(
      "empty username disables/rejects proceeding",
      "An empty username must not be allowed to proceed to the password step.",
      "negative",
      { username: "" },
    );
    push(
      "whitespace-only username disables/rejects proceeding",
      "A whitespace-only username must not be allowed to proceed to the password step.",
      "negative",
      { username: "   " },
    );
    push(
      "SQL injection payload in username is rejected safely",
      "A SQL injection payload must be rejected without leaking a database error or advancing to the password step.",
      "negative",
      { username: "' OR '1'='1' --" },
    );
    push(
      "XSS payload in username is not executed",
      "A script payload in the username must never be reflected/executed unescaped.",
      "negative",
      { username: "<script>alert(1)</script>" },
    );
    push(
      "unicode username is handled gracefully",
      "Unicode input in the username field should be handled without crashing or corrupting the page.",
      "negative",
      { username: "Ünïcödé文字123" },
    );
    push(
      "padded valid username is trimmed and accepted",
      "Leading/trailing whitespace around a valid username should be trimmed server-side, not rejected — login should still succeed.",
      "positive",
      { username: `  ${credentials.username}  `, password: credentials.password },
    );
    push(
      "username matching is case-insensitive",
      "A valid username submitted in a different case should still be accepted and log in successfully.",
      "positive",
      { username: credentials.username.toUpperCase(), password: credentials.password },
    );
    push(
      "password field is visually masked",
      "The password input must visually mask its value (type=password or an equivalent masking style).",
      "positive",
      { username: credentials.username, password: credentials.password },
    );
    push(
      "empty password disables/rejects login",
      "An empty password must not be allowed to submit.",
      "negative",
      { username: credentials.username, password: "" },
    );
    push(
      "whitespace-only password disables/rejects login",
      "A whitespace-only password must not be allowed to submit.",
      "negative",
      { username: credentials.username, password: "   " },
    );
    push(
      "padded password is rejected (not trimmed)",
      "Unlike the username, a padded-but-otherwise-correct password must be rejected — passwords should be compared literally, not trimmed.",
      "negative",
      { username: credentials.username, password: `  ${credentials.password}  ` },
    );
  }

  return cases;
}
