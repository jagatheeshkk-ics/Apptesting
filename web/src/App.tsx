import { NavLink, Route, Routes } from "react-router-dom";
import NewTestRun from "./pages/NewTestRun.js";
import TestRuns from "./pages/TestRuns.js";
import TestRunDetail from "./pages/TestRunDetail.js";
import Accounts from "./pages/Accounts.js";
import KpiDashboard from "./pages/KpiDashboard.js";

export default function App() {
  return (
    <div className="layout">
      <nav className="sidebar">
        <h1>AppTesting Agent</h1>
        <NavLink to="/" end>
          New test run
        </NavLink>
        <NavLink to="/runs">Test runs</NavLink>
        <NavLink to="/accounts">Accounts</NavLink>
        <NavLink to="/kpi">KPI dashboard</NavLink>
      </nav>
      <div className="content">
        <Routes>
          <Route path="/" element={<NewTestRun />} />
          <Route path="/runs" element={<TestRuns />} />
          <Route path="/runs/:id" element={<TestRunDetail />} />
          <Route path="/accounts" element={<Accounts />} />
          <Route path="/kpi" element={<KpiDashboard />} />
        </Routes>
      </div>
    </div>
  );
}
