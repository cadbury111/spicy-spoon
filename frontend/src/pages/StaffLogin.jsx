import { useState, useEffect } from "react";
import { ShieldCheck, ChefHat, Lock, User, ArrowLeft, KeyRound, AlertCircle, RefreshCw, Sparkles, ArrowRight } from "lucide-react";
import { api } from "../api";
import "./StaffLogin.css";

function StaffLogin({ defaultRole = "ADMIN", onLoginSuccess }) {
  const [selectedRole, setSelectedRole] = useState(defaultRole);
  const [username, setUsername] = useState(defaultRole === "ADMIN" ? "admin" : "kitchen");
  const [password, setPassword] = useState(defaultRole === "ADMIN" ? "admin123" : "kitchen123");
  const [errorMsg, setErrorMsg] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setSelectedRole(defaultRole);
    if (defaultRole === "ADMIN") {
      setUsername("admin");
      setPassword("admin123");
    } else {
      setUsername("kitchen");
      setPassword("kitchen123");
    }
  }, [defaultRole]);

  const executeLogin = async (uName, pWord, roleType) => {
    setErrorMsg("");
    setLoading(true);

    try {
      const res = await api.staffLogin({
        username: uName.trim(),
        password: pWord,
        role: roleType,
      });

      if (res.token && res.user) {
        localStorage.setItem("spicy_staff_token", res.token);
        localStorage.setItem("spicy_staff_user", JSON.stringify(res.user));

        if (onLoginSuccess) {
          onLoginSuccess(res.user);
        } else {
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

  const handleFormSubmit = (e) => {
    e.preventDefault();
    executeLogin(username, password, selectedRole);
  };

  const handleRoleSelect = (roleType) => {
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
          <div className={`staff-icon-badge ${selectedRole.toLowerCase()}`}>
            {selectedRole === "ADMIN" ? <ShieldCheck size={32} /> : <ChefHat size={32} />}
          </div>
          <h2>
            SPICY <span>SPOON</span>
          </h2>
          <p className="staff-portal-tag">INTERNAL STAFF & OPERATIONS PORTAL</p>
        </div>

        {/* Role Tabs */}
        <div className="staff-role-tabs">
          <button
            type="button"
            className={`role-tab-btn ${selectedRole === "ADMIN" ? "active admin" : ""}`}
            onClick={() => handleRoleSelect("ADMIN")}
          >
            <ShieldCheck size={16} />
            <span>🛡️ Admin Portal</span>
          </button>
          <button
            type="button"
            className={`role-tab-btn ${selectedRole === "KITCHEN" ? "active kitchen" : ""}`}
            onClick={() => handleRoleSelect("KITCHEN")}
          >
            <ChefHat size={16} />
            <span>👨‍🍳 Kitchen KDS</span>
          </button>
        </div>

        {/* Role Explanation Card */}
        <div className="role-description-banner">
          {selectedRole === "ADMIN" ? (
            <div>
              <strong>🛡️ General Manager / Admin Mode:</strong>
              <p>Full control over Floor Map, Table Reservations, Live Invoices, Cash Settlement, Menu Editing, and Staff.</p>
            </div>
          ) : (
            <div>
              <strong>👨‍🍳 Chef / Kitchen KDS Mode:</strong>
              <p>Dedicated 4-Lane Kitchen Expediting Board: Accept Tickets, Cooking Station 🔥, Ready for Service 🍽️.</p>
            </div>
          )}
        </div>

        {errorMsg && (
          <div className="staff-error-banner">
            <AlertCircle size={16} />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Direct 1-Click Fast Pass */}
        <div className="instant-login-section">
          <span className="instant-tag">⚡ 1-CLICK INSTANT PORTAL ACCESS:</span>
          <div className="instant-buttons-grid">
            <button
              type="button"
              className="btn-instant-admin"
              onClick={() => executeLogin("admin", "admin123", "ADMIN")}
              disabled={loading}
            >
              <ShieldCheck size={16} />
              <span>Launch Admin Dashboard →</span>
            </button>
            <button
              type="button"
              className="btn-instant-kitchen"
              onClick={() => executeLogin("kitchen", "kitchen123", "KITCHEN")}
              disabled={loading}
            >
              <ChefHat size={16} />
              <span>Launch Kitchen KDS →</span>
            </button>
          </div>
        </div>

        <div className="divider-or">
          <span>OR SIGN IN WITH CUSTOM CREDENTIALS</span>
        </div>

        {/* Form */}
        <form onSubmit={handleFormSubmit} className="staff-form">
          <div className="staff-input-group">
            <label>Staff Username</label>
            <div className="input-with-icon">
              <User size={16} className="input-icon" />
              <input
                type="text"
                required
                placeholder={selectedRole === "ADMIN" ? "admin" : "kitchen"}
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
                placeholder="Password"
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
                <span>Log In to {selectedRole === "ADMIN" ? "Admin Portal" : "Kitchen KDS"} →</span>
              </>
            )}
          </button>
        </form>

        {/* Footer Link */}
        <div className="staff-login-footer">
          <a href="#home" className="back-public-link">
            <ArrowLeft size={14} /> Back to Guest Restaurant Website
          </a>
        </div>
      </div>
    </div>
  );
}

export default StaffLogin;
