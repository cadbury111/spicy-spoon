import { useState } from "react";
import { ShieldCheck, ChefHat, Lock, User, ArrowLeft, KeyRound, AlertCircle, RefreshCw } from "lucide-react";
import { api } from "../api";
import "./StaffLogin.css";

function StaffLogin({ defaultRole = "ADMIN", onLoginSuccess }) {
  const [selectedRole, setSelectedRole] = useState(defaultRole);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e) => {
    e.preventDefault();
    setErrorMsg("");
    setLoading(true);

    try {
      const res = await api.staffLogin({
        username: username.trim(),
        password,
        role: selectedRole,
      });

      if (res.token && res.user) {
        localStorage.setItem("spicy_staff_token", res.token);
        localStorage.setItem("spicy_staff_user", JSON.stringify(res.user));

        if (onLoginSuccess) {
          onLoginSuccess(res.user);
        } else {
          // Redirect based on role
          if (res.user.role === "ADMIN") {
            window.location.hash = "#/admin";
          } else if (res.user.role === "KITCHEN") {
            window.location.hash = "#/kitchen";
          } else {
            window.location.hash = "#home";
          }
        }
      }
    } catch (err) {
      setErrorMsg(err.message || "Invalid staff credentials. Please check your username and password.");
    } finally {
      setLoading(false);
    }
  };

  const handleQuickFill = (roleType) => {
    setSelectedRole(roleType);
    if (roleType === "ADMIN") {
      setUsername("admin");
      setPassword("admin123");
    } else {
      setUsername("kitchen");
      setPassword("kitchen123");
    }
    setErrorMsg("");
  };

  return (
    <div className="staff-login-page">
      <div className="staff-login-card">
        {/* Brand Header */}
        <div className="staff-login-header">
          <div className="staff-icon-badge">
            {selectedRole === "ADMIN" ? <ShieldCheck size={28} /> : <ChefHat size={28} />}
          </div>
          <h2>
            SPICY <span>SPOON</span>
          </h2>
          <p className="staff-portal-tag">INTERNAL STAFF OPERATIONS PORTAL</p>
        </div>

        {/* Role Tabs */}
        <div className="staff-role-tabs">
          <button
            type="button"
            className={`role-tab-btn ${selectedRole === "ADMIN" ? "active" : ""}`}
            onClick={() => setSelectedRole("ADMIN")}
          >
            <ShieldCheck size={16} />
            <span>Admin Portal</span>
          </button>
          <button
            type="button"
            className={`role-tab-btn ${selectedRole === "KITCHEN" ? "active" : ""}`}
            onClick={() => setSelectedRole("KITCHEN")}
          >
            <ChefHat size={16} />
            <span>Kitchen KDS</span>
          </button>
        </div>

        {errorMsg && (
          <div className="staff-error-banner">
            <AlertCircle size={16} />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleLogin} className="staff-form">
          <div className="staff-input-group">
            <label>Staff Username</label>
            <div className="input-with-icon">
              <User size={16} className="input-icon" />
              <input
                type="text"
                required
                placeholder={selectedRole === "ADMIN" ? "e.g. admin" : "e.g. kitchen"}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>
          </div>

          <div className="staff-input-group">
            <label>Password</label>
            <div className="input-with-icon">
              <Lock size={16} className="input-icon" />
              <input
                type="password"
                required
                placeholder="Enter password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          </div>

          <button type="submit" className="btn-staff-submit" disabled={loading}>
            {loading ? (
              <RefreshCw className="spin-icon" size={18} />
            ) : (
              <>
                <KeyRound size={18} />
                <span>Authenticate as {selectedRole} →</span>
              </>
            )}
          </button>
        </form>

        {/* Quick Demo Credentials */}
        <div className="quick-dev-credentials">
          <span className="quick-label">Development Quick Access:</span>
          <div className="quick-btn-row">
            <button type="button" onClick={() => handleQuickFill("ADMIN")}>
              Fill Admin (admin / admin123)
            </button>
            <button type="button" onClick={() => handleQuickFill("KITCHEN")}>
              Fill Kitchen (kitchen / kitchen123)
            </button>
          </div>
        </div>

        {/* Footer Link */}
        <div className="staff-login-footer">
          <a href="#home" className="back-public-link">
            <ArrowLeft size={14} /> Back to Public Restaurant Website
          </a>
        </div>
      </div>
    </div>
  );
}

export default StaffLogin;
