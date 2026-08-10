import { useEffect, useState } from "react";
import { NavLink, Route, Routes } from "react-router-dom";
import NewTestRun from "./pages/NewTestRun.js";
import TestRuns from "./pages/TestRuns.js";
import TestRunDetail from "./pages/TestRunDetail.js";
import Accounts from "./pages/Accounts.js";
import Flows from "./pages/Flows.js";
import Users from "./pages/Users.js";
import Projects from "./pages/Projects.js";
import Reports from "./pages/Reports.js";
import KpiDashboard from "./pages/KpiDashboard.js";
import Login from "./pages/Login.js";
import { User, api } from "./api.js";

type AuthState =
  | { status: "checking" }
  | { status: "disabled" }
  | { status: "signed-out" }
  | { status: "signed-in"; user: User };

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

  return (
    <div className="layout">
      <nav className="sidebar">
        <h1>AppTesting Agent</h1>
        <NavLink to="/" end>
          New test run
        </NavLink>
        <NavLink to="/runs">Test runs</NavLink>
        <NavLink to="/projects">Projects</NavLink>
        <NavLink to="/accounts">Accounts</NavLink>
        <NavLink to="/flows">Flows</NavLink>
        <NavLink to="/users">Users</NavLink>
        <NavLink to="/reports">Reports</NavLink>
        <NavLink to="/kpi">KPI dashboard</NavLink>
        {auth.status === "signed-in" && (
          <div style={{ marginTop: "auto", paddingTop: 16, fontSize: 13, color: "#59636e" }}>
            Signed in as {auth.user.displayName || auth.user.username}
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
          <Route path="/" element={<NewTestRun />} />
          <Route path="/runs" element={<TestRuns />} />
          <Route path="/runs/:id" element={<TestRunDetail />} />
          <Route path="/projects" element={<Projects />} />
          <Route path="/accounts" element={<Accounts />} />
          <Route path="/flows" element={<Flows />} />
          <Route path="/users" element={<Users />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/kpi" element={<KpiDashboard />} />
        </Routes>
      </div>
    </div>
  );
}
