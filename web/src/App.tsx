import { ReactNode, useEffect, useState } from "react";
import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import NewTestRun from "./pages/NewTestRun.js";
import TestRuns from "./pages/TestRuns.js";
import TestRunDetail from "./pages/TestRunDetail.js";
import Accounts from "./pages/Accounts.js";
import Flows from "./pages/Flows.js";
import Users from "./pages/Users.js";
import Roles from "./pages/Roles.js";
import Projects from "./pages/Projects.js";
import Reports from "./pages/Reports.js";
import KpiDashboard from "./pages/KpiDashboard.js";
import Login from "./pages/Login.js";
import { PAGE_LABELS, PageKey, User, api } from "./api.js";

type AuthState =
  | { status: "checking" }
  | { status: "disabled" }
  | { status: "signed-out" }
  | { status: "signed-in"; user: User };

const PAGE_PATHS: Record<PageKey, string> = {
  "new-test-run": "/",
  "test-runs": "/runs",
  projects: "/projects",
  accounts: "/accounts",
  flows: "/flows",
  users: "/users",
  roles: "/roles",
  reports: "/reports",
  kpi: "/kpi",
};

const ALL_PAGES = Object.keys(PAGE_LABELS) as PageKey[];

export default function App() {
  const [auth, setAuth] = useState<AuthState>({ status: "checking" });

  useEffect(() => {
    api
      .authStatus()
      .then(({ enabled }) => {
        if (!enabled) {
          setAuth({ status: "disabled" });
          return;
        }
        api.me().then(async (res) => {
          if (res.ok) {
            const { user } = await res.json();
            setAuth({ status: "signed-in", user });
          } else {
            setAuth({ status: "signed-out" });
          }
        });
      })
      .catch(() => setAuth({ status: "disabled" }));
  }, []);

  async function onLogout() {
    await api.logout();
    setAuth({ status: "signed-out" });
  }

  if (auth.status === "checking") return null;
  if (auth.status === "signed-out") {
    return <Login onAuthenticated={(user) => setAuth({ status: "signed-in", user })} />;
  }

  // No role assigned = unrestricted (matches server-side default).
  const allowedPages: PageKey[] = auth.status === "signed-in" ? auth.user.role?.allowedPages ?? ALL_PAGES : ALL_PAGES;
  const canSee = (page: PageKey) => allowedPages.includes(page);
  const homePath = PAGE_PATHS[allowedPages[0] ?? "new-test-run"];

  function Guard({ page, children }: { page: PageKey; children: ReactNode }) {
    if (!canSee(page)) return <Navigate to={homePath} replace />;
    return <>{children}</>;
  }

  return (
    <div className="layout">
      <nav className="sidebar">
        <h1>AppTesting Agent</h1>
        {canSee("new-test-run") && (
          <NavLink to="/" end>
            New test run
          </NavLink>
        )}
        {canSee("test-runs") && <NavLink to="/runs">Test runs</NavLink>}
        {canSee("projects") && <NavLink to="/projects">Projects</NavLink>}
        {canSee("accounts") && <NavLink to="/accounts">Accounts</NavLink>}
        {canSee("flows") && <NavLink to="/flows">Flows</NavLink>}
        {canSee("users") && <NavLink to="/users">Users</NavLink>}
        {canSee("roles") && <NavLink to="/roles">Roles</NavLink>}
        {canSee("reports") && <NavLink to="/reports">Reports</NavLink>}
        {canSee("kpi") && <NavLink to="/kpi">KPI dashboard</NavLink>}
        {auth.status === "signed-in" && (
          <div style={{ marginTop: "auto", paddingTop: 16, fontSize: 13, color: "#59636e" }}>
            Signed in as {auth.user.displayName || auth.user.username}
            {auth.user.role && <div>Role: {auth.user.role.name}</div>}
            <br />
            <button
              onClick={onLogout}
              style={{ background: "none", border: "none", color: "#59636e", cursor: "pointer", padding: 0, marginTop: 6 }}
            >
              Sign out
            </button>
          </div>
        )}
      </nav>
      <div className="content">
        <Routes>
          <Route
            path="/"
            element={
              <Guard page="new-test-run">
                <NewTestRun />
              </Guard>
            }
          />
          <Route
            path="/runs"
            element={
              <Guard page="test-runs">
                <TestRuns />
              </Guard>
            }
          />
          <Route
            path="/runs/:id"
            element={
              <Guard page="test-runs">
                <TestRunDetail />
              </Guard>
            }
          />
          <Route
            path="/projects"
            element={
              <Guard page="projects">
                <Projects />
              </Guard>
            }
          />
          <Route
            path="/accounts"
            element={
              <Guard page="accounts">
                <Accounts />
              </Guard>
            }
          />
          <Route
            path="/flows"
            element={
              <Guard page="flows">
                <Flows />
              </Guard>
            }
          />
          <Route
            path="/users"
            element={
              <Guard page="users">
                <Users />
              </Guard>
            }
          />
          <Route
            path="/roles"
            element={
              <Guard page="roles">
                <Roles />
              </Guard>
            }
          />
          <Route
            path="/reports"
            element={
              <Guard page="reports">
                <Reports />
              </Guard>
            }
          />
          <Route
            path="/kpi"
            element={
              <Guard page="kpi">
                <KpiDashboard />
              </Guard>
            }
          />
        </Routes>
      </div>
    </div>
  );
}
